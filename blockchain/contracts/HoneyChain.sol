// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HoneyChain: on-chain provenance for honey batches
/// @notice Records honey batches with a DUAL-SIGNATURE (dual-EOA) protocol. A batch is first registered
///         with the harvester's signature, and only becomes CERTIFIED with a second signature from a
///         certified KVIC / testing officer. Jars (QR codes) and loose sales are recorded against the batch,
///         and the contract itself refuses to let jars plus loose sales exceed the honey harvested.
///         The backend also anchors the head of the off-chain audit ledger here, so history cannot be
///         quietly rewritten by whoever runs the server.
/// @dev    All actions are authorised by EIP-712 signatures, so a relayer (the Honey Chain backend) can pay
///         gas without being able to forge anything. Private data never goes on chain: only hashes, a
///         content identifier (IPFS CID) of the public metadata, and quantities.
contract HoneyChain {
    // ---------------------------------------------------------------- roles
    address public owner;      // KVIC head account: grants roles
    address public anchorer;   // account allowed to anchor ledger heads (the backend relayer)
    mapping(address => bool) public officers;    // certified officers
    mapping(address => bool) public harvesters;  // registered, approved keepers

    // ---------------------------------------------------------------- data
    struct Batch {
        address harvester;
        address officer;          // zero until certified
        uint64 harvestedAt;
        uint64 registeredAt;
        uint64 certifiedAt;
        uint32 quantityGrams;
        uint32 jarGrams;          // grams reserved by registered jars
        uint32 looseGrams;        // grams sold loose
        bool certified;
        bool passed;              // the officer's verdict on the lab certificate
        bytes32 ledgerEventHash;  // hash of the HARVEST_RECORDED event in the off-chain ledger
        bytes32 labReportHash;    // sha256 of the lab certificate (or its PDF)
        string metadataCid;       // IPFS CID of the public metadata (origin, lab values, officer)
    }

    struct JarLot { bytes32 lotId; bytes32 merkleRoot; uint32 count; uint32 jarGrams; uint64 registeredAt; }
    struct LooseSale { bytes32 batchId; uint32 grams; bool reversed; }

    mapping(bytes32 => Batch) private batches;
    mapping(bytes32 => JarLot[]) private lots;
    mapping(bytes32 => bool) public lotUsed;
    mapping(bytes32 => LooseSale) public looseSales;

    uint64 public anchoredHeight;
    bytes32 public anchoredHead;
    uint64 public anchoredAt;

    // ---------------------------------------------------------------- events
    event RoleChanged(address indexed account, string role, bool enabled);
    event BatchRegistered(bytes32 indexed batchId, address indexed harvester, uint32 quantityGrams, bytes32 ledgerEventHash);
    event BatchCertified(bytes32 indexed batchId, address indexed officer, bool passed, bytes32 labReportHash, string metadataCid);
    event JarsRegistered(bytes32 indexed batchId, bytes32 indexed lotId, bytes32 merkleRoot, uint32 count, uint32 jarGrams);
    event LooseSaleRecorded(bytes32 indexed batchId, bytes32 indexed saleId, uint32 grams, bytes32 buyerHash);
    event LooseSaleReversed(bytes32 indexed batchId, bytes32 indexed saleId, uint32 grams);
    event LedgerAnchored(uint64 indexed height, bytes32 head, uint64 anchoredTime);

    // ---------------------------------------------------------------- EIP-712
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REGISTER_TYPEHASH = keccak256("RegisterBatch(bytes32 batchId,address harvester,uint32 quantityGrams,uint64 harvestedAt,bytes32 ledgerEventHash)");
    bytes32 private constant CERTIFY_TYPEHASH = keccak256("CertifyBatch(bytes32 batchId,address officer,bytes32 labReportHash,string metadataCid,bool passed)");
    bytes32 private constant JARS_TYPEHASH = keccak256("RegisterJars(bytes32 lotId,bytes32 batchId,bytes32 merkleRoot,uint32 count,uint32 jarGrams)");
    bytes32 private constant SALE_TYPEHASH = keccak256("LooseSale(bytes32 saleId,bytes32 batchId,uint32 grams,bytes32 buyerHash)");
    bytes32 private constant REVERSE_TYPEHASH = keccak256("ReverseLooseSale(bytes32 saleId,bytes32 batchId)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    constructor(address anchorer_) {
        owner = msg.sender;
        anchorer = anchorer_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("HoneyChain"), keccak256("1"), block.chainid, address(this)));
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    // ---------------------------------------------------------------- roles
    function setOfficer(address account, bool enabled) external onlyOwner {
        officers[account] = enabled;
        emit RoleChanged(account, "officer", enabled);
    }

    function setHarvester(address account, bool enabled) external onlyOwner {
        harvesters[account] = enabled;
        emit RoleChanged(account, "harvester", enabled);
    }

    function setAnchorer(address account) external onlyOwner {
        anchorer = account;
        emit RoleChanged(account, "anchorer", true);
    }

    // ---------------------------------------------------------------- batches
    /// @notice Step 1: the harvester signs the batch. Anyone (the relayer) may submit it.
    function registerBatch(
        bytes32 batchId, uint32 quantityGrams, uint64 harvestedAt, bytes32 ledgerEventHash, address harvester, bytes calldata signature
    ) external {
        require(batches[batchId].registeredAt == 0, "batch exists");
        require(harvesters[harvester], "not a registered harvester");
        require(quantityGrams > 0, "empty batch");

        bytes32 digest = _digest(keccak256(abi.encode(REGISTER_TYPEHASH, batchId, harvester, quantityGrams, harvestedAt, ledgerEventHash)));
        require(_recover(digest, signature) == harvester, "bad harvester signature");

        Batch storage b = batches[batchId];
        b.harvester = harvester;
        b.harvestedAt = harvestedAt;
        b.registeredAt = uint64(block.timestamp);
        b.quantityGrams = quantityGrams;
        b.ledgerEventHash = ledgerEventHash;
        emit BatchRegistered(batchId, harvester, quantityGrams, ledgerEventHash);
    }

    /// @notice Step 2: a certified officer signs the lab result. This is the second signature (dual-EOA).
    function certifyBatch(
        bytes32 batchId, bytes32 labReportHash, string calldata metadataCid, bool passed, address officer, bytes calldata signature
    ) external {
        Batch storage b = batches[batchId];
        require(b.registeredAt != 0, "unknown batch");
        require(!b.certified, "already certified");
        require(officers[officer], "not a certified officer");

        bytes32 digest = _digest(keccak256(abi.encode(CERTIFY_TYPEHASH, batchId, officer, labReportHash, keccak256(bytes(metadataCid)), passed)));
        require(_recover(digest, signature) == officer, "bad officer signature");

        b.certified = true;
        b.passed = passed;
        b.officer = officer;
        b.certifiedAt = uint64(block.timestamp);
        b.labReportHash = labReportHash;
        b.metadataCid = metadataCid;
        emit BatchCertified(batchId, officer, passed, labReportHash, metadataCid);
    }

    // ---------------------------------------------------------------- jars
    /// @notice Registers a run of QR jars as a Merkle root. The contract enforces the honey limit.
    function registerJars(
        bytes32 lotId, bytes32 batchId, bytes32 merkleRoot, uint32 count, uint32 jarGrams, bytes calldata signature
    ) external {
        Batch storage b = batches[batchId];
        require(b.certified && b.passed, "batch is not certified");
        require(!lotUsed[lotId], "lot exists");
        require(count > 0 && jarGrams > 0, "empty lot");

        bytes32 digest = _digest(keccak256(abi.encode(JARS_TYPEHASH, lotId, batchId, merkleRoot, count, jarGrams)));
        require(_recover(digest, signature) == b.harvester, "bad harvester signature");

        uint64 grams = uint64(count) * uint64(jarGrams);
        require(uint64(b.jarGrams) + uint64(b.looseGrams) + grams <= uint64(b.quantityGrams), "more jars than honey");

        b.jarGrams += uint32(grams);
        lotUsed[lotId] = true;
        lots[batchId].push(JarLot(lotId, merkleRoot, count, jarGrams, uint64(block.timestamp)));
        emit JarsRegistered(batchId, lotId, merkleRoot, count, jarGrams);
    }

    // ---------------------------------------------------------------- loose sales
    /// @notice Records honey sold loose (kg or grams) to a buyer. The buyer is stored only as a hash.
    function recordLooseSale(
        bytes32 saleId, bytes32 batchId, uint32 grams, bytes32 buyerHash, bytes calldata signature
    ) external {
        Batch storage b = batches[batchId];
        require(b.registeredAt != 0, "unknown batch");
        require(looseSales[saleId].grams == 0, "sale exists");
        require(grams > 0, "empty sale");

        bytes32 digest = _digest(keccak256(abi.encode(SALE_TYPEHASH, saleId, batchId, grams, buyerHash)));
        require(_recover(digest, signature) == b.harvester, "bad harvester signature");
        require(uint64(b.jarGrams) + uint64(b.looseGrams) + uint64(grams) <= uint64(b.quantityGrams), "more honey than harvested");

        b.looseGrams += grams;
        looseSales[saleId] = LooseSale(batchId, grams, false);
        emit LooseSaleRecorded(batchId, saleId, grams, buyerHash);
    }

    function reverseLooseSale(bytes32 saleId, bytes calldata signature) external {
        LooseSale storage sale = looseSales[saleId];
        require(sale.grams != 0 && !sale.reversed, "nothing to reverse");
        Batch storage b = batches[sale.batchId];

        bytes32 digest = _digest(keccak256(abi.encode(REVERSE_TYPEHASH, saleId, sale.batchId)));
        require(_recover(digest, signature) == b.harvester, "bad harvester signature");

        sale.reversed = true;
        b.looseGrams -= sale.grams;
        emit LooseSaleReversed(sale.batchId, saleId, sale.grams);
    }

    // ---------------------------------------------------------------- ledger anchor
    /// @notice Pins the head hash of the off-chain audit ledger. Heights must only move forward.
    function anchorLedger(uint64 height, bytes32 head) external {
        require(msg.sender == anchorer, "only anchorer");
        require(height >= anchoredHeight, "height moved backwards");
        anchoredHeight = height;
        anchoredHead = head;
        anchoredAt = uint64(block.timestamp);
        emit LedgerAnchored(height, head, anchoredAt);
    }

    // ---------------------------------------------------------------- reads
    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function lotCount(bytes32 batchId) external view returns (uint256) {
        return lots[batchId].length;
    }

    function getLot(bytes32 batchId, uint256 index) external view returns (JarLot memory) {
        return lots[batchId][index];
    }

    /// @notice True if `leaf` (keccak256 of a jar ID) belongs to a jar lot registered for a certified batch.
    ///         Uses sorted-pair keccak Merkle proofs.
    function verifyJar(bytes32 batchId, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        Batch storage b = batches[batchId];
        if (!b.certified || !b.passed) return false;

        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = computed < proof[i] ? keccak256(abi.encodePacked(computed, proof[i])) : keccak256(abi.encodePacked(proof[i], computed));
        }

        JarLot[] storage list = lots[batchId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].merkleRoot == computed) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- internals
    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recover(bytes32 digest, bytes memory sig) private pure returns (address) {
        require(sig.length == 65, "bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad signature v");
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad signature s");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad signature");
        return signer;
    }
}
