import { Routes, Route, Navigate } from 'react-router-dom'

import SplashScreen from './pages/SplashScreen'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Hives from './pages/HivesWorkspace'
import BeehiveMonitor from './pages/BeehiveMonitorIntegrated'

import Harvest from './pages/Harvest'
import Inventory from './pages/Inventory'
import Laboratory from './pages/Laboratory'
import SupplyChain from './pages/SupplyChain'
import Buyers from './pages/Buyers'
import Billing from './pages/Billing'
import Orders from './pages/Orders'
import Finance from './pages/FinanceWorkspace'
import Predictions from './pages/Predictions'
import Traceability from './pages/Traceability'
import QRManagement from './pages/QRManagement'
import Inspections from './pages/Inspections'
import Schemes from './pages/Schemes'
import Help from './pages/Help'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import PublicVerify from './pages/PublicVerify'

export default function App() {
  return (
    <Routes>

      <Route
        path="/"
        element={<SplashScreen />}
      />

      <Route
        path="/login"
        element={<Login />}
      />

      {/* Public consumer verification, opened by scanning a bottle QR code */}
      <Route
        path="/verify"
        element={<PublicVerify />}
      />

      <Route
        path="/dashboard"
        element={<Dashboard />}
      />

      <Route
        path="/orders"
        element={<Orders />}
      />

      <Route
        path="/hives"
        element={<Hives />}
      />

      <Route
        path="/iot"
        element={<Navigate to="/hives" replace />}
      />

      <Route
        path="/iot-monitoring/:hiveId"
        element={<BeehiveMonitor />}
      />

      <Route
        path="/hive-health"
        element={<Navigate to="/hives" replace />}
      />

      <Route
        path="/harvest"
        element={<Harvest />}
      />

      <Route
        path="/inventory"
        element={<Inventory />}
      />

      <Route
        path="/laboratory"
        element={<Laboratory />}
      />

      <Route
        path="/supply-chain"
        element={<SupplyChain />}
      />

      <Route
        path="/buyers"
        element={<Buyers />}
      />

      <Route
        path="/billing"
        element={<Billing />}
      />

      <Route
        path="/finance"
        element={<Finance />}
      />

      <Route
        path="/predictions"
        element={<Predictions />}
      />

      <Route
        path="/traceability"
        element={<Traceability />}
      />

      <Route
        path="/qr-management"
        element={<QRManagement />}
      />

      <Route
        path="/schemes"
        element={<Schemes />}
      />

      <Route
        path="/help"
        element={<Help />}
      />

      <Route
        path="/inspections"
        element={<Inspections />}
      />

      <Route
        path="/notifications"
        element={<Notifications />}
      />

      <Route
        path="/settings"
        element={<Settings />}
      />

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />

    </Routes>
  )
}