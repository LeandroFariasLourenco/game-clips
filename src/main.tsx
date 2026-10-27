import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import App from './App.tsx';
import { CachedOutlet } from './components/CachedOutlet';
import { HomePage } from './pages/HomePage';
import { GameDetailsPage } from './pages/GameDetailsPage';
import './index.css';

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      {
        element: <CachedOutlet />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'game/:gameId', element: <GameDetailsPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
