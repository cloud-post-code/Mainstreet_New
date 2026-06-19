import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCart } from '../cart/CartContext'
import MainStLogo from './MainStLogo'
import styles from './TopNav.module.css'

export default function TopNav() {
  const { token, user, logout } = useAuth()
  const cart = useCart()
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path: string) => location.pathname.startsWith(path)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const onCartClick = () => {
    if (!token) {
      navigate('/login')
      return
    }
    cart.open()
  }

  return (
    <nav className={styles.nav}>
      <div className={styles.links}>
        <Link
          to="/"
          state={{ newChat: Date.now() }}
          className={styles.brand}
          aria-label="Main St. home"
        >
          <MainStLogo size="nav" />
        </Link>
      </div>
      <div className={styles.rightSide}>
        {user?.is_admin && (
          <Link
            to="/admin"
            className={`${styles.link} ${isActive('/admin') ? styles.active : ''}`}
          >
            Admin
          </Link>
        )}
        <Link
          to="/"
          className={`${styles.link} ${location.pathname === '/' ? styles.active : ''}`}
        >
          Home
        </Link>
        <Link
          to="/mason"
          className={`${styles.link} ${isActive('/mason') ? styles.active : ''}`}
        >
          Mason
        </Link>
<Link
          to="/discover"
          className={`${styles.link} ${isActive('/discover') ? styles.active : ''}`}
        >
          Discover
        </Link>
        {token ? (
          <button type="button" className={styles.button} onClick={handleLogout}>
            Log out
          </button>
        ) : (
          <Link to="/login" className={styles.button}>Log in</Link>
        )}
        <button
          type="button"
          className={styles.inboxBtn}
          onClick={() => navigate('/mason?tab=inbox')}
          aria-label="Inbox"
          title="Inbox"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.cartBtn}
          onClick={onCartClick}
          aria-label={`Open cart (${cart.itemCount} items)`}
        >
          <span aria-hidden="true" className={styles.cartIcon}>🛒</span>
          {cart.itemCount > 0 && (
            <span className={styles.badge}>{cart.itemCount}</span>
          )}
        </button>
      </div>
    </nav>
  )
}
