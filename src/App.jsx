import React, { lazy, Suspense } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { ToastProvider } from "./components/Toast.jsx";

const HomePage             = lazy(() => import("./pages/HomePage.jsx"));
const PlayersPage          = lazy(() => import("./pages/PlayersPage.jsx"));
const PlayerDetailPage     = lazy(() => import("./pages/PlayerDetailPage.jsx"));
const ClansPage            = lazy(() => import("./pages/ClansPage.jsx"));
const ClanDetailPage       = lazy(() => import("./pages/ClanDetailPage.jsx"));
const VaultLeaderboardPage = lazy(() => import("./pages/VaultLeaderboardPage.jsx"));
const SettingsPage         = lazy(() => import("./pages/SettingsPage.jsx"));
const MyAccountsPage       = lazy(() => import("./pages/MyAccountsPage.jsx"));
const AccountSkillsPage    = lazy(() => import("./pages/AccountSkillsPage.jsx"));
const ReportsPage          = lazy(() => import("./pages/ReportsPage.jsx"));
const PvmCorrelationPage   = lazy(() => import("./pages/PvmCorrelationPage.jsx"));
const CasesPage            = lazy(() => import("./pages/CasesPage.jsx"));
const SimilarNameClansPage = lazy(() => import("./pages/SimilarNameClansPage.jsx"));
const CrossClanMatchesPage = lazy(() => import("./pages/CrossClanMatchesPage.jsx"));
const ClanSkillSignalsPage = lazy(() => import("./pages/ClanSkillSignalsPage.jsx"));
const PotentialClansPage   = lazy(() => import("./pages/PotentialClansPage.jsx"));
const PlayerComparePage    = lazy(() => import("./pages/PlayerComparePage.jsx"));
const LiveSearchPage       = lazy(() => import("./pages/LiveSearchPage.jsx"));
const LeaderboardsPage     = lazy(() => import("./pages/LeaderboardsPage.jsx"));
const ChatPage             = lazy(() => import("./pages/ChatPage.jsx"));
const EquippedItemsPage    = lazy(() => import("./pages/EquippedItemsPage.jsx"));
const TaskActivityPage     = lazy(() => import("./pages/TaskActivityPage.jsx"));
const MarketPage           = lazy(() => import("./pages/MarketPage.jsx"));
const PlayerInspectorPage  = lazy(() => import("./pages/PlayerInspectorPage.jsx"));

function PageLoader(){
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", opacity: 0.35, fontSize: 13,
    }}>
      Loading…
    </div>
  );
}

export default function App(){
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/players" element={<PlayersPage />} />
                <Route path="/players/:name" element={<PlayerDetailPage />} />
                <Route path="/clans" element={<ClansPage />} />
                <Route path="/clans/:name" element={<ClanDetailPage />} />
                <Route path="/vault-leaderboard" element={<VaultLeaderboardPage />} />
                <Route path="/compare" element={<PlayerComparePage />} />
                <Route path="/discover" element={<LiveSearchPage />} />
                <Route path="/leaderboards" element={<LeaderboardsPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/pvm-correlation" element={<PvmCorrelationPage />} />
                <Route path="/cases" element={<CasesPage />} />
                <Route path="/name-matches" element={<SimilarNameClansPage />} />
                <Route path="/cross-clan-matches" element={<CrossClanMatchesPage />} />
                <Route path="/clan-skill-signals" element={<ClanSkillSignalsPage />} />
                <Route path="/potential-clans" element={<PotentialClansPage />} />
                <Route path="/my-accounts" element={<MyAccountsPage />} />
                <Route path="/my-accounts/:username/skills" element={<AccountSkillsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/equipped-items" element={<EquippedItemsPage />} />
                <Route path="/task-activity" element={<TaskActivityPage />} />
                <Route path="/player-inspector" element={<PlayerInspectorPage />} />
                <Route path="/market" element={<MarketPage />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
