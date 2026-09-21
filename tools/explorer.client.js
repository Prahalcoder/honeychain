(function () {
  var D = window.DATA;
  var app = document.getElementById('app');
  var state = { tab: 'picture', commonTable: null, company: 0, privTable: null, block: null, search: '' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function short(h) { return h ? h.slice(0, 10) + '…' + h.slice(-6) : '—'; }
  function when(v) { var d = new Date(v); return isNaN(d) ? esc(v) : d.toLocaleString('en-IN'); }

  function tableView(t) {
    var q = state.search.toLowerCase();
    var rows = t.rows.filter(function (r) { return !q || r.join(' ').toLowerCase().indexOf(q) >= 0; });
    var head = t.columns.map(function (c) {
      return '<th>' + (c.key ? '<span class="pk">●</span> ' : '') + esc(c.name) + '<small>' + esc(c.type) + (c.sensitive ? ' · hidden' : '') + '</small></th>';
    }).join('');
    var body = rows.map(function (r) {
      return '<tr>' + r.map(function (v, i) {
        if (v === null) return '<td class="nul">null</td>';
        return '<td class="' + (t.columns[i].sensitive ? 'hid' : '') + '" title="' + esc(v) + '">' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="card"><h3>' + esc(t.name) + ' <span class="badge info">' + esc(t.category) + '</span></h3>' +
      '<p class="lead" style="margin-bottom:10px">' + esc(t.description) + '</p>' +
      '<p style="margin:0 0 10px"><b>' + num(t.count) + '</b> rows · showing the latest ' + t.rows.length + ' · ' + t.columns.length + ' columns</p>' +
      '<input class="search" data-search placeholder="Filter the rows shown…" value="' + esc(state.search) + '">' +
      '<div class="tablewrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + (body || '<tr><td colspan="' + t.columns.length + '">No rows.</td></tr>') + '</tbody></table></div></div>';
  }

  function tableList(tables, current, action) {
    var out = '';
    var groups = {};
    tables.forEach(function (t) { (groups[t.category] = groups[t.category] || []).push(t); });
    Object.keys(groups).forEach(function (g) {
      out += '<h4>' + esc(g) + '</h4>';
      groups[g].forEach(function (t) {
        out += '<button class="' + (t.name === current ? 'on' : '') + '" data-' + action + '="' + esc(t.name) + '">' + esc(t.name) + '<span class="count">' + num(t.count) + '</span></button>';
      });
    });
    return out;
  }

  function pictureTab() {
    var c = D.common, p = D.private;
    function count(name) { var t = c.filter(function (x) { return x.name === name; })[0]; return t ? t.count : 0; }
    var orgs = D.organizations.map(function (o) { return '<span class="pill">' + esc(o.status.replace('_', ' ').toLowerCase()) + ': ' + o.n + '</span>'; }).join('');
    return '<h2>Where every piece of data lives</h2>' +
      '<p class="lead">Honey Chain keeps a company’s business data in its <b>own private database file</b>. The KVIC admin app can only ever open the <b>common secure database</b>, which holds identities, approvals and the <b>blockchain</b>. The three things that cross from a private database to the common one are shown in the middle.</p>' +
      '<div class="arch">' +
      '<div class="zone keeper"><h3>Honey Chain Keeper</h3><small>Beekeeper app · port 5173</small><ul><li>Keeper API <code>/api/company</code></li><li><b>One private database per company</b> (' + p.length + ' file' + (p.length === 1 ? '' : 's') + ')</li><li>Hives, harvests, finance, buyers, invoices, notes</li><li>Never readable by any officer</li></ul></div>' +
      '<div class="chain-mid"><div>Only these cross over<small>1 · monthly income total</small><small>2 · blockchain events</small><small>3 · batch and jar registry</small></div></div>' +
      '<div class="zone admin"><h3>Honey Chain Admin</h3><small>KVIC portal · port 5174</small><ul><li>Admin API <code>/api/admin</code></li><li><b>Common secure database</b> (<code>' + esc(D.commonFile) + '</code>)</li><li>Logins, approvals, inspections, notices, audit log</li><li><b>Shared blockchain</b>: hash-chained events in signed blocks</li></ul></div></div>' +
      '<div class="grid g4" style="margin-top:22px">' +
      '<div class="card stat"><b>' + p.length + '</b><span>private company databases</span></div>' +
      '<div class="card stat"><b>' + count('users') + '</b><span>logins in the common database</span></div>' +
      '<div class="card stat"><b>' + num(D.chain.events) + '</b><span>blockchain events</span></div>' +
      '<div class="card stat"><b>' + num(D.chain.blocks) + '</b><span>sealed blocks</span></div></div>' +
      '<div class="card" style="margin-top:18px"><h3>Chain integrity, re-checked just now by this tool</h3>' +
      (D.chain.valid ? '<div class="note">✔ Every event hash, every block link, every Merkle root and every validator signature verified independently of the application.</div>'
        : '<div class="note bad">✘ Problem found: ' + esc(D.chain.problems.join('; ')) + '</div>') +
      '<p style="margin:12px 0 0">Organisations: ' + (orgs || 'none yet') + '</p></div>' +
      '<div class="grid g3" style="margin-top:18px">' +
      '<div class="card"><h3>1 · Income total only</h3><p class="lead" style="margin:0">Line-by-line finance stays private. The admin sees one number per company per month (<code>monthly_reports</code>).</p></div>' +
      '<div class="card"><h3>2 · Blockchain events</h3><p class="lead" style="margin:0">Harvests, lab verification, QR creation, inspections and closures are written as hash-linked events. Nobody can edit or delete them.</p></div>' +
      '<div class="card"><h3>3 · Batch and jar registry</h3><p class="lead" style="margin:0">Batch numbers, quantities and one row per jar, so consumers can verify a QR without seeing any private data.</p></div></div>';
  }

  function commonTab() {
    var t = D.common.filter(function (x) { return x.name === state.commonTable; })[0] || D.common[0];
    state.commonTable = t.name;
    return '<h2>Common secure database</h2><p class="lead">Database <code>' + esc(D.commonFile) + '</code>. This is the only data the admin app reads. Passwords and signing keys are shown as <i>hidden</i>: they are never displayed.</p>' +
      '<div class="split"><div class="list">' + tableList(D.common, t.name, 'common') + '</div><div>' + tableView(t) + '</div></div>';
  }

  function privateTab() {
    if (!D.private.length) return '<h2>Private company databases</h2><div class="note warn">No company has registered yet, so no private database exists. Register a company in the keeper app and refresh.</div>';
    var i = Math.min(state.company, D.private.length - 1);
    var p = D.private[i];
    var t = p.tables.filter(function (x) { return x.name === state.privTable; })[0] || p.tables[0];
    state.privTable = t.name;
    var chooser = D.private.map(function (x, k) {
      return '<button class="' + (k === i ? 'on' : '') + '" data-company="' + k + '">' + esc(x.organization.legal_name) + '<small>' + esc(x.organization.organization_code) + ' · ' + esc(x.state) + '</small></button>';
    }).join('');
    var incomeRows = p.isolation.privateIncome.map(function (r) { return '<tr><td>' + esc(r.month) + '</td><td>' + num(r.entries) + ' entries</td><td>' + inr(r.income) + '</td></tr>'; }).join('');
    var sharedRows = p.isolation.sharedMonthly.map(function (r) { return '<tr><td>' + esc(r.month) + '</td><td>' + inr(r.income_inr) + '</td></tr>'; }).join('');
    return '<h2>Private databases, one per company</h2><p class="lead">Each company has its own private schema, a separate set of tables. The admin API has no code path that reads them. This inspector opens them read-only <b>for demonstration only</b>.</p>' +
      '<div class="split"><div class="list"><h4>Companies</h4>' + chooser + '</div><div>' +
      '<div class="card company"><h3>' + esc(p.organization.legal_name) + ' <span class="badge info">' + esc(p.state) + '</span></h3>' +
      '<p style="margin:0"><code>' + esc(p.file) + '</code> · ' + num(p.bytes) + ' bytes · ' + esc(p.organization.region || '') + (p.organization.region ? ', ' : '') + esc(p.organization.state || '') + ' · status <b>' + esc(p.organization.status || '?') + '</b></p>' +
      '<p style="margin:10px 0 0">' + p.tables.map(function (x) { return '<span class="pill">' + esc(x.name) + ' ' + num(x.count) + '</span>'; }).join('') + '</p></div>' +
      '<div class="card company"><h3>Isolation proof: what stays private and what the admin can see</h3><div class="compare private">' +
      '<div class="card"><b style="color:var(--green)">PRIVATE · finance_entries (only this company can read)</b><div class="tablewrap" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Month</th><th>Detail</th><th>Income</th></tr></thead><tbody>' + (incomeRows || '<tr><td colspan="3">No finance entries yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="card"><b style="color:var(--violet)">SHARED · monthly_reports (what the admin sees)</b><div class="tablewrap" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Month</th><th>Income total</th></tr></thead><tbody>' + (sharedRows || '<tr><td colspan="2">Nothing shared yet.</td></tr>') + '</tbody></table></div></div></div></div>' +
      '<div class="split" style="grid-template-columns:230px minmax(0,1fr)"><div class="list">' + tableList(p.tables, t.name, 'priv') + '</div><div>' + tableView(t) + '</div></div></div></div>';
  }

  function chainTab() {
    var c = D.chain;
    var sel = c.chain.filter(function (b) { return b.height === state.block; })[0] || c.chain[c.chain.length - 1];
    if (sel) state.block = sel.height;
    var blocks = c.chain.map(function (b, i) {
      return (i ? '<div class="link"></div>' : '') + '<button class="block ' + (b.height === state.block ? 'on ' : '') + (b.ok ? '' : 'badb') + '" data-block="' + b.height + '"><b>Block #' + b.height + '</b> ' + (b.ok ? '<span class="badge ok">verified</span>' : '<span class="badge bad">broken</span>') +
        '<code>hash ' + esc(short(b.blockHash)) + '</code><code>prev ' + esc(short(b.prevHash)) + '</code><code>merkle ' + esc(short(b.merkleRoot)) + '</code><small>' + b.txCount + ' transactions · ' + esc(b.validator) + '</small></button>';
    }).join('');
    var detail = '';
    if (sel) {
      var checks = Object.keys(sel.checks).map(function (k) { return '<span class="' + (sel.checks[k] ? 'y' : 'n') + '">' + (sel.checks[k] ? '✔ ' : '✘ ') + esc(k) + '</span>'; }).join('');
      var events = sel.events.map(function (e) {
        return '<tr><td>' + e.id + '</td><td>' + esc(e.type) + '</td><td>' + esc(e.entity) + '</td><td title="' + esc(e.hash) + '">' + esc(short(e.hash)) + '</td><td title="' + esc(e.prev) + '">' + esc(short(e.prev)) + '</td><td>' + when(e.at) + '</td><td title="' + esc(e.payload) + '">' + esc(e.payload) + '</td></tr>';
      }).join('');
      detail = '<div class="card" style="margin-top:8px"><h3>Block #' + sel.height + ' in detail</h3><p style="margin:0">Sealed ' + when(sel.timestamp) + ' by <b>' + esc(sel.validator) + '</b> · ed25519 signature <code>' + esc(short(sel.signature)) + '</code></p><div class="checks">' + checks + '</div>' +
        '<p class="lead" style="margin:12px 0 8px">Each event’s <code>prev</code> hash equals the previous event’s hash. Changing any field changes its hash, which breaks every later link, the Merkle root and the signature.</p>' +
        '<div class="tablewrap"><table><thead><tr><th>#</th><th>Event</th><th>Entity</th><th>Hash</th><th>Prev hash</th><th>Time</th><th>Payload</th></tr></thead><tbody>' + (events || '<tr><td colspan="7">The genesis block has no events.</td></tr>') + '</tbody></table></div></div>';
    }
    return '<h2>Shared blockchain</h2><p class="lead">Append-only: database triggers reject any update or delete of events and blocks. This page recomputed every hash itself.</p>' +
      '<div class="card" style="margin-bottom:16px">' + (c.valid ? '<div class="note">✔ Chain valid · ' + num(c.events) + ' events in ' + num(c.blocks) + ' blocks</div>' : '<div class="note bad">✘ ' + esc(c.problems.join('; ')) + '</div>') +
      '<p style="margin:12px 0 0">Validator' + (c.validators.length === 1 ? '' : 's') + ': ' + c.validators.map(function (v) { return '<span class="pill">' + esc(v.id) + ' · key ' + esc(v.fingerprint) + '</span>'; }).join('') + (c.orphanEvents ? ' <span class="badge bad">' + c.orphanEvents + ' events not yet sealed</span>' : '') + '</p></div>' +
      (c.hidden ? '<p class="lead">Showing the latest 60 blocks (' + c.hidden + ' older blocks not shown).</p>' : '') +
      '<div class="chainrow">' + blocks + '</div>' + detail;
  }


  function link(o, kind, value, label) {
    if (!o.explorer || !value) return esc(label);
    return '<a href="' + esc(o.explorer) + '/' + kind + '/' + esc(value) + '" target="_blank" rel="noopener">' + esc(label) + '</a>';
  }

  function contractTab() {
    var o = D.onchain;
    var head = '<h2>Smart contract on the blockchain</h2><p class="lead">Read live from the chain RPC <code>' + esc(o.rpc) + '</code>, not from a database. A batch is registered with the <b>harvester’s signature</b> and certified with a <b>certified officer’s signature</b> (EIP-712). Jars are proven with a Merkle root, and the head of the ledger is anchored here.</p>';
    if (!o.reachable || o.error) head += '<div class="note warn">' + esc(o.error || 'The chain could not be reached.') + '</div>';
    var status = o.reachable && o.contract ? '<div class="card" style="margin-bottom:16px"><div class="grid g4"><div class="stat card"><b>' + esc(o.chainId) + '</b><span>chain ID</span></div><div class="stat card"><b>' + num(o.blockNumber) + '</b><span>latest block</span></div><div class="stat card"><b>' + num(o.eventCount) + '</b><span>contract events</span></div><div class="stat card"><b>' + (o.anchor ? '#' + o.anchor.height : '—') + '</b><span>ledger head anchored</span></div></div>' +
      '<p style="margin:12px 0 0">Contract <code>' + link(o, 'address', o.contract, o.contract) + '</code>' + (o.deployment ? ' · deployed by <code>' + esc(short(o.deployment.owner)) + '</code>' : '') + '</p>' +
      (o.anchor && o.anchor.height ? '<p style="margin:6px 0 0">Anchored head <code>' + esc(short(o.anchor.head)) + '</code> ' + (o.anchor.matchesLedger ? '<span class="badge ok">equals block #' + o.anchor.height + ' of the ledger</span>' : '<span class="badge bad">does not match the ledger</span>') + '</p>' : '') + '</div>' : '';

    function block(title, note, cols, rows) {
      return '<div class="card" style="margin-bottom:16px"><h3>' + title + '</h3><p class="lead" style="margin:0 0 8px">' + note + '</p><div class="tablewrap" style="max-height:340px"><table><thead><tr>' + cols.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + cols.length + '">Nothing yet.</td></tr>') + '</tbody></table></div></div>';
    }
    var events = o.events.map(function (e) {
      return '<tr><td>' + e.block + '</td><td><b>' + esc(e.name) + '</b></td><td title="' + esc(e.tx) + '">' + link(o, 'tx', e.tx, short(e.tx)) + '</td><td title="' + esc(JSON.stringify(e.args)) + '">' + esc(JSON.stringify(e.args)) + '</td></tr>';
    }).join('');
    var txs = o.transactions.map(function (t) {
      return '<tr><td>' + t.block + '</td><td><b>' + esc(t.method) + '</b></td><td title="' + esc(t.hash) + '">' + link(o, 'tx', t.hash, short(t.hash)) + '</td><td title="' + esc(t.from) + '">' + esc(short(t.from)) + '</td><td>' + num(t.gasUsed) + '</td><td>' + (t.status === 1 ? '<span class="badge ok">success</span>' : '<span class="badge bad">reverted</span>') + '</td></tr>';
    }).join('');
    var wallets = o.wallets.map(function (w) {
      return '<tr><td>' + esc(w.username || '(relayer)') + '</td><td>' + esc(w.role || '') + '</td><td title="' + esc(w.address) + '">' + esc(w.address) + '</td><td>' + when(w.created_at) + '</td></tr>';
    }).join('');
    var outbox = o.outbox.map(function (r) {
      return '<tr><td>' + r.id + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.status) + '</td><td>' + (r.block_number || '') + '</td><td title="' + esc(r.tx_hash || '') + '">' + link(o, 'tx', r.tx_hash, short(r.tx_hash)) + '</td><td>' + r.attempts + '</td><td>' + esc(r.last_error || '') + '</td></tr>';
    }).join('');

    return head + status +
      block('Contract events', 'Newest first. Every event is emitted by the contract itself, so it cannot be edited afterwards.', ['Block', 'Event', 'Transaction', 'Values'], events) +
      block('Transactions', 'Each one is sent by the relayer, which pays the gas. The signature that authorises a batch is inside the transaction and is checked by the contract.', ['Block', 'Function', 'Hash', 'Sent by', 'Gas used', 'Result'], txs) +
      block('Signing accounts', 'One account per keeper and officer, created automatically. The private key is stored encrypted (AES-256-GCM), so only the address is shown.', ['User', 'Role', 'Address', 'Created'], wallets) +
      block('Queue of transactions (database → chain)', 'The backend writes an intent here in the same step as the business action, then a worker signs and sends it and retries on failure. This is what makes the link reliable.', ['#', 'Kind', 'Reference', 'Status', 'Block', 'Transaction', 'Tries', 'Last error'], outbox);
  }

  function render() {
    var tabs = [['picture', 'The big picture'], ['common', 'Common secure database'], ['private', 'Private company databases'], ['chain', 'Blockchain ledger'], ['contract', 'Smart contract']];
    app.innerHTML = '<header class="top"><h1>Honey Chain Data Explorer</h1><p>Read-only view of the databases behind the Keeper and Admin apps · generated ' + when(D.generatedAt) + (window.LIVE ? ' · <b>live: reload the page to refresh</b>' : '') + '</p><nav class="tabs">' +
      tabs.map(function (t) { return '<button class="' + (state.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav></header>' +
      '<main>' + ({ picture: pictureTab, common: commonTab, private: privateTab, chain: chainTab, contract: contractTab })[state.tab]() +
      '<p class="foot">Sensitive columns (password hashes, encrypted signing keys) are never displayed. Databases are opened read-only.</p></main>';
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = b.dataset;
    if (d.tab) { state.tab = d.tab; state.search = ''; }
    else if (d.common) { state.commonTable = d.common; state.search = ''; }
    else if (d.priv) { state.privTable = d.priv; state.search = ''; }
    else if (d.company) { state.company = Number(d.company); state.privTable = null; state.search = ''; }
    else if (d.block) { state.block = Number(d.block); }
    else return;
    render();
  });
  app.addEventListener('input', function (e) {
    if (!e.target.matches('[data-search]')) return;
    state.search = e.target.value; var pos = e.target.selectionStart; render();
    var i = app.querySelector('[data-search]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
  });
  render();
})();
