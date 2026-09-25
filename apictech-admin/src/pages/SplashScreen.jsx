export default function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-ring splash-ring-outer" />
      <div className="splash-ring splash-ring-inner" />
      <div className="splash-content">
        <div className="splash-logo">
          <img src="/honeychain-logo.png" alt="Honey Chain logo" />
        </div>
        <p className="splash-eyebrow">KVIC Control Portal</p>
        <h1 className="splash-title">Honey Chain Admin</h1>
        <p className="splash-subtitle">Approvals, oversight and the network ledger</p>
        <div className="splash-bar"><div className="splash-bar-fill" /></div>
        <p className="splash-footer">Connecting every drop to its source</p>
      </div>
    </div>
  )
}
