import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AgentsPage } from './pages/AgentsPage';
import { NewSpacePage } from './pages/NewSpacePage';
import { SettingsPage } from './pages/SettingsPage';
import { SpaceDetailPage } from './pages/SpaceDetailPage';
import { SpacesGrid } from './pages/SpacesGrid';
import { cn } from './lib/utils';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-secondary text-secondary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );
}

function Nav(): React.ReactElement {
  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-3">
        <NavLink to="/" className={navLinkClass} end>
          Spaces
        </NavLink>
        <NavLink to="/agents" className={navLinkClass}>
          Agents
        </NavLink>
        <NavLink to="/settings" className={navLinkClass}>
          Settings
        </NavLink>
      </nav>
    </header>
  );
}

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<SpacesGrid />} />
        <Route path="/new" element={<NewSpacePage />} />
        <Route path="/space/:id" element={<SpaceDetailPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
