import { CartDrawer, Footer, Header } from "./components.jsx";
import Account from "./pages/Account.jsx";
import Book from "./pages/Book.jsx";
import Checkout from "./pages/Checkout.jsx";
import Home from "./pages/Home.jsx";
import { TableCheckout, TableMenu } from "./pages/Table.jsx";
import Track from "./pages/Track.jsx";
import { AppProvider, Link, usePath } from "./state.jsx";

function Routes() {
  const path = usePath();
  let page;
  let m;
  if (path === "/" || path === "") page = <Home />;
  else if (path === "/checkout") page = <Checkout />;
  else if (path === "/book") page = <Book />;
  else if (path === "/account") page = <Account />;
  else if (path === "/t/checkout") page = <TableCheckout />;
  else if ((m = path.match(/^\/t\/([^/]+)$/))) page = <TableMenu key={m[1]} token={decodeURIComponent(m[1])} />;
  else if ((m = path.match(/^\/order\/(\d+)$/))) page = <Track key={m[1]} id={Number(m[1])} />;
  else page = <div className="page narrow"><h1>Page not found</h1><Link to="/" className="btn primary">Go to the menu</Link></div>;

  return (
    <>
      <Header />
      <main>{page}</main>
      <Footer />
      <CartDrawer />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes />
    </AppProvider>
  );
}
