import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'
import CartDrawer from './CartDrawer'

export default function AppLayout() {
  return (
    <>
      <TopNav />
      <Outlet />
      <CartDrawer />
    </>
  )
}
