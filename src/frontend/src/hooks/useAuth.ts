export default function useAuth() {
  const isAuthenticated = () => {
    const token = localStorage.getItem('token');
    return !!token;
  };
  return { isAuthenticated };
}
