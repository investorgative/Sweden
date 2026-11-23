import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { AnalyticsProvider } from '@/store/analytics'
import { Overview } from '@/pages/Overview'
import { Journal } from '@/pages/Journal'
import { CalendarPage } from '@/pages/Calendar'
import { Analytics } from '@/pages/Analytics'
import { EdgeReport } from '@/pages/EdgeReport'
import { DreamHouse } from '@/pages/DreamHouse'
import { Achievements } from '@/pages/Achievements'
import { SettingsPage } from '@/pages/Settings'

export default function App() {
  return (
    <HashRouter>
      <AnalyticsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="journal" element={<Journal />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="edge" element={<EdgeReport />} />
            <Route path="dream" element={<DreamHouse />} />
            <Route path="achievements" element={<Achievements />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Overview />} />
          </Route>
        </Routes>
      </AnalyticsProvider>
    </HashRouter>
  )
}
