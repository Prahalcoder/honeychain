import {
  Bell,
  FlaskConical,
  Store,
  CheckCircle2,
  ClipboardCheck,
  LifeBuoy,
  Megaphone,
} from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { useApi } from '../lib/store'

const ICONS = { lab: FlaskConical, organization: Store, inspection: ClipboardCheck, announcement: Megaphone, support: LifeBuoy }

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Notifications() {
  const { data, loading } = useApi('/company/notifications')
  const notifications = data || []

  return (
    <MainLayout title="Notifications">

      <div>
        <h1 className="text-2xl font-black">
          Notifications
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Decisions your KVIC officers make about your organisation and lab results.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white">

        <div className="flex items-center gap-3 border-b border-gray-100 p-6">
          <div className="rounded-xl bg-[#dbedeb] p-3">
            <Bell size={21} />
          </div>

          <div>
            <h2 className="font-bold">
              Officer decisions
            </h2>

            <p className="text-xs text-gray-500">
              {notifications.length} notification{notifications.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div>
          {!loading && notifications.length === 0 && (
            <p className="p-8 text-center text-sm text-gray-500">
              Nothing yet. You'll see approvals and lab verifications here.
            </p>
          )}

          {notifications.map((notification) => {
            const Icon = ICONS[notification.type] || Bell

            return (
              <div
                key={notification.id}
                className="flex gap-4 border-b border-gray-100 p-6 last:border-0"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#dbedeb]">
                  <Icon size={20} />
                </div>

                <div className="flex-1">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row">
                    <h3 className="font-bold">{notification.title}</h3>
                    <span className="text-xs text-gray-400">{formatTime(notification.time)}</span>
                  </div>

                  <p className="mt-2 text-sm leading-6 text-gray-500">
                    {notification.message}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

      </div>

      <div className="mt-6 rounded-2xl border border-[#c0dfdd] bg-white p-6">
        <div className="flex gap-3">
          <CheckCircle2 size={20} className="text-teal-600" />

          <div>
            <p className="font-bold">
              Live from the KVIC control room
            </p>

            <p className="mt-1 text-sm text-gray-500">
              When a regional officer accepts your organisation or verifies a lab
              report, it is recorded on the blockchain and appears here.
            </p>
          </div>
        </div>
      </div>

    </MainLayout>
  )
}
