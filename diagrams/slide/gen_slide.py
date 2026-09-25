import html, os

OUT = os.path.dirname(os.path.abspath(__file__))

BLUE = '#0a3fc9'      # header bars, like the reference slide
NAVY = '#0b1f5c'
PANEL = '#e3ebf8'
WHITE = '#ffffff'
INK = '#14213d'
AMBER = '#f5a524'
TEAL = '#0f766e'
CORAL = '#e8563f'
GREEN = '#15803d'
PURPLE = '#6d3fc9'
FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"


class Slide:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">',
                  '''<defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#0b1f5c"/></marker>
<marker id="ad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c47f00"/></marker>
</defs>''']

    def t(self, x, y, s, size=8, weight=400, fill=INK, anchor='start', extra=''):
        self.p.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{html.escape(s)}</text>')

    def box(self, x, y, w, h, fill=WHITE, stroke=NAVY, sw=0.9, rx=2, dash=False):
        d = ' stroke-dasharray="3 2"' if dash else ''
        self.p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def panel(self, x, y, w, h, title, color=BLUE, hh=14, size=8.6, sub=None):
        """Light panel with a solid header bar, the style of the reference diagram."""
        self.box(x, y, w, h, fill=PANEL, stroke=color, sw=1)
        self.p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{hh}" fill="{color}"/>')
        self.t(x + 5, y + hh - 4, title, size, 800, '#fff', extra='letter-spacing="0.3"')
        if sub:
            self.t(x + w - 5, y + hh - 4.2, sub, size - 2, 600, '#dbe6ff', 'end')

    def card(self, x, y, w, h, lines, icon=None, stroke=NAVY, dash=False, fill=WHITE, size=7.4, weight=600, color=INK):
        self.box(x, y, w, h, fill=fill, stroke=stroke, dash=dash)
        tx = x + (15 if icon else 5)
        if icon:
            self.t(x + 8, y + h / 2 + 4, icon, 11, 400, INK, 'middle')
        n = len(lines)
        top = y + h / 2 - (n - 1) * (size + 1.6) / 2 + size * 0.35
        for i, ln in enumerate(lines):
            small = ln.startswith('~')
            txt = ln[1:] if small else ln
            self.t(tx, top + i * (size + 1.6), txt, size - (0.9 if small else 0), 400 if small else weight, '#4a5878' if small else color)

    def arrow(self, x1, y1, x2, y2, label=None, both=False, dash=False, color=NAVY, lx=None, ly=None):
        m = 'ad' if color == '#c47f00' else 'a'
        d = ' stroke-dasharray="3 2"' if dash else ''
        st = f' marker-start="url(#{m})"' if both else ''
        self.p.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.1"{d} marker-end="url(#{m})"{st}/>')
        if label:
            lx = (x1 + x2) / 2 if lx is None else lx
            ly = (y1 + y2) / 2 - 2.5 if ly is None else ly
            w = len(label) * 3.6 + 5
            self.p.append(f'<rect x="{lx - w / 2:.1f}" y="{ly - 5.4:.1f}" width="{w:.1f}" height="7.4" rx="3.5" fill="#fff" stroke="{color}" stroke-width="0.5"/>')
            self.t(lx, ly, label, 5.2, 700, color, 'middle')

    def save(self, name):
        self.p.append('</svg>')
        path = os.path.join(OUT, name)
        open(path, 'w', encoding='utf-8').write('\n'.join(self.p))
        return path


# =============================================================== architecture: 710 x 240 (top-left cell of the slide)
def architecture():
    s = Slide(710, 240)

    # ---- column 1: users (top) and the hive device (bottom)
    s.panel(3, 3, 112, 112, 'USERS')
    for i, (icon, a, b) in enumerate([('👩‍🌾', 'Beekeeper', '~Keeper app'), ('🏛️', 'KVIC Officer', '~Admin portal'), ('🛒', 'Buyer / Consumer', '~Public website')]):
        s.card(8, 20 + i * 31, 102, 27, [a, b], icon=icon)

    s.panel(3, 121, 112, 116, 'EDGE DEVICE', sub='hive')
    s.card(8, 138, 102, 30, ['ESP32 node', '~Wi-Fi, Arduino C++'], icon='📡')
    s.card(8, 172, 102, 25, ['DHT11 ×2 · MQ gas'], icon='🌡️', size=6.9)
    s.card(8, 201, 102, 30, ['Camera + OLED', '~fan / heater relays'], icon='📷')

    # ---- column 2: web apps (top) and the IoT service (bottom)
    s.panel(133, 3, 118, 112, 'WEB APPS', sub='React 19')
    for i, (a, b) in enumerate([('Keeper app', 'hives · harvest · orders'), ('Admin portal', 'approvals · lab review'), ('Public website', 'verify QR · Sellers nearby')]):
        s.card(138, 20 + i * 31, 108, 27, [a, '~' + b])

    s.panel(133, 121, 118, 116, 'IoT SERVICE', sub='Python · Flask')
    s.card(138, 138, 108, 30, ['Flask + OpenCV', '~live stream, snapshots'], icon='📹')
    s.card(138, 172, 108, 25, ['Hive data log'], icon='🗂️', size=6.9)
    s.card(138, 201, 108, 30, ['HiveSense AI', '~planned model'], icon='🧠', stroke='#c47f00', dash=True, fill='#fff7e0')

    # ---- column 3: the API
    s.panel(272, 3, 200, 234, 'HONEY CHAIN API', sub='Node.js · Express 5')
    s.card(279, 21, 186, 28, ['Security layer', '~JWT · roles · jurisdiction · rate limits'], icon='🔐')
    s.card(279, 53, 186, 28, ['Business services', '~batches · lab review · custody · shop'], icon='⚙️')
    s.card(279, 85, 186, 28, ['Tamper-evident ledger', '~hash-chained blocks per action'], icon='⛓️')
    s.card(279, 117, 186, 28, ['Chain outbox + relayer', '~EIP-712 signed transactions'], icon='📤')
    s.card(279, 149, 186, 34, ['HiveSense AI engine', '~hive health · anomaly · lab-risk score'], icon='🧠', stroke='#c47f00', dash=True, fill='#fff7e0')
    s.card(279, 187, 186, 44, ['Public verify API', '~QR → batch, lab result, officer', '~signature, Merkle proof'], icon='🔎')

    # ---- column 4: data and trust
    s.panel(490, 3, 217, 234, 'DATA & TRUST LAYER', color=NAVY)
    s.card(497, 21, 203, 66, ['PostgreSQL 18', '~public schema: users, batches, ledger', '~co_<org> private schema per company', '~row-level security, immutable ledger'], icon='🗄️')
    s.card(497, 92, 203, 66, ['Smart contract (Solidity)', '~batch registered · certified', '~jars Merkle root · loose sales', '~ledger anchor · EVM-compatible chain'], icon='📜')
    s.card(497, 163, 203, 68, ['Documents (IPFS CID)', '~lab report metadata hashed', '~contract stores only the CID', '~pin to any IPFS node'], icon='📁')

    # ---- arrows
    s.arrow(110, 60, 138, 60, 'HTTPS', both=True, lx=124, ly=54)
    s.arrow(246, 60, 279, 60, 'REST + JWT', both=True, lx=262, ly=54)
    s.arrow(110, 180, 138, 180, 'Wi-Fi JSON', lx=124, ly=174)
    s.arrow(246, 180, 279, 180, both=True, dash=True, color='#c47f00')
    s.arrow(465, 53, 497, 53, 'SQL', both=True, lx=481, ly=47)
    s.arrow(465, 131, 497, 131, 'JSON-RPC', both=True, lx=481, ly=125)
    s.arrow(465, 209, 497, 209, both=True, lx=481, ly=203)
    return s.save('architecture_710x240.svg')


# =============================================================== tech stack: 710 x 372 (bottom-left cell of the slide)
def techstack():
    s = Slide(710, 372)
    groups = [
        ('FRONTEND', BLUE, '🖥️', [('React 19', 'UI of the 3 web apps'), ('Vite 8', 'build and bundling'), ('Tailwind CSS 4', 'responsive styling')]),
        ('BACKEND', TEAL, '⚙️', [('Node.js + Express 5', 'REST API'), ('JWT + bcrypt', 'sign-in and roles'), ('ethers.js v6', 'blockchain client')]),
        ('DATABASE', PURPLE, '🗄️', [('PostgreSQL 18', 'records, schema per company'), ('Row-level security', 'data isolation'), ('SHA-256 ledger', 'tamper-evident log')]),
        ('BLOCKCHAIN', NAVY, '⛓️', [('Solidity 0.8', 'smart contract'), ('EVM-compatible chain', 'Polygon Amoy ready'), ('IPFS CID + Merkle proof', 'documents, jar proofs')]),
        ('IoT / EDGE', CORAL, '📡', [('ESP32', 'Arduino C++ firmware'), ('DHT11 + MQ gas', 'temperature, humidity, gas'), ('Flask + OpenCV', 'data API, camera')]),
        ('AI  ·  HiveSense', '#c47f00', '🧠', [('scikit-learn', 'Python ML pipeline'), ('XGBoost + Isolation Forest', 'health score, anomalies'), ('ONNX Runtime', 'model serving')]),
    ]
    cw, ch = 226, 178
    gx, gy = 7, 8
    for i, (title, color, icon, items) in enumerate(groups):
        col, row = i % 3, i // 3
        x = 3 + col * (cw + gx)
        y = 3 + row * (ch + gy)
        planned = title.startswith('AI')
        s.box(x, y, cw, ch, fill='#fff7e0' if planned else PANEL, stroke=color, sw=1.3, rx=3, dash=planned)
        s.p.append(f'<rect x="{x}" y="{y}" width="{cw}" height="30" rx="3" fill="{color}"/><rect x="{x}" y="{y + 20}" width="{cw}" height="10" fill="{color}"/>')
        s.t(x + 10, y + 21, icon, 15, 400, '#fff')
        s.t(x + 34, y + 21, title, 14, 800, '#fff', extra='letter-spacing="0.4"')
        if planned:
            s.t(x + cw - 8, y + 20, 'to be built', 8.5, 700, '#ffe7b0', 'end')
        for j, (name, role) in enumerate(items):
            yy = y + 40 + j * 45
            s.box(x + 10, yy, cw - 20, 39, fill='#fff', stroke=color, sw=0.9, rx=4)
            s.t(x + cw / 2, yy + 18, name, 13.2, 700, INK, 'middle')
            s.t(x + cw / 2, yy + 31, role, 8.6, 500, '#5a6785', 'middle')
    return s.save('techstack_710x372.svg')


print(architecture())
print(techstack())
