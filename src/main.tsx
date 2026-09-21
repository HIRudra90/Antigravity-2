import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/index.css'

// The boundary wraps everything, including the providers. React unmounts the
// whole tree on an uncaught render error, so without this a throw anywhere —
// even on one page — left nothing but the background canvas and no clue why.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
