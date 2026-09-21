import os from 'node:os'

// The address other devices on the same Wi-Fi can use to reach this computer (a phone scanning a QR code,
// or opening the apps). Empty string when the computer is not on a network.
export function lanAddress() {
  const candidates = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) continue
      // Prefer a real Wi-Fi/Ethernet adapter over virtual ones (VirtualBox, Hyper-V, WSL, Docker, VPN).
      const virtual = /virtual|vethernet|vmware|hyper-v|wsl|docker|vpn|tap|tun|loopback/i.test(name)
      candidates.push({ address: item.address, virtual })
    }
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual))
  return candidates[0]?.address || ''
}

// Origins allowed to call the API from a browser: this computer and any private-network address on the
// three app ports, so a phone on the same Wi-Fi can open the apps.
export const isAllowedOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(5173|5174|5175)$/.test(origin)
