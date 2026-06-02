import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import styles from './TopNav.module.css'

export default function TopNav() {
  const { token, user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className={styles.nav}>
      <Link to="/discover" className={styles.brand}>MAIN ST</Link>
      <div className={styles.links}>
        <Link
          to="/discover"
          className={`${styles.link} ${isActive('/discover') ? styles.active : ''}`}
        >
          Discover
        </Link>
        <Link
          to="/"
          className={`${styles.link} ${isActive('/') ? styles.active : ''}`}
        >
          Chat
        </Link>
        {user?.is_admin && (
          <Link
            to="/admin"
            className={`${styles.link} ${isActive('/admin') ? styles.active : ''}`}
          >
            Admin
          </Link>
        )}
        {token ? (
          <button type="button" className={styles.button} onClick={handleLogout}>
            Log out
          </button>
        ) : (
          <Link to="/login" className={styles.button}>Log in</Link>
        )}
      </div>
    </nav>
  )
}
