import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCart } from '../cart/CartContext'
import styles from './TopNav.module.css'

export default function TopNav() {
  const { token, user, logout } = useAuth()
  const cart = useCart()
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

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
          className={`${styles.link} ${isActive('/') ? styles.active : ''}`}
        >
          Chat
        </Link>
        <Link
          to="/discover"
          className={`${styles.link} ${isActive('/discover') ? styles.active : ''}`}
        >
          Discover
        </Link>
        <Link
          to="/inbox"
          className={`${styles.link} ${isActive('/inbox') ? styles.active : ''}`}
        >
          Inbox
        </Link>
      </div>
      <div className={styles.rightSide}>
        <Link to="/discover" className={styles.brand}>MAIN ST</Link>
        {token ? (
          <button type="button" className={styles.button} onClick={handleLogout}>
            Log out
          </button>
        ) : (
          <Link to="/login" className={styles.button}>Log in</Link>
        )}
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
