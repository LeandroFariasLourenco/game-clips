import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import App from './App.tsx';
import { CachedOutlet } from './components/CachedOutlet';
import { HomePage } from './pages/HomePage';
import { GameDetailsPage } from './pages/GameDetailsPage';
import './index.css';

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      {
        element: <CachedOutlet />,
        children: [
          { index: true, element: <HomePage /> },
          { path: ':gameName', element: <GameDetailsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
], { basename });

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
