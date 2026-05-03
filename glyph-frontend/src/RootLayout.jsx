import { Outlet } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'

function RootLayout() {
    return (
        <AuthProvider>
            <Outlet />
        </AuthProvider>
    )
}

export default RootLayout
