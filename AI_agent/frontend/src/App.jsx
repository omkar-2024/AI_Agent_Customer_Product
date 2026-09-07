import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Login from "./Login";
import Register from "./Register";
import Chatbot from "./Chatbot";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
export { supabase };

export default function App() {
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("login");
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="center-page">Loading...</div>;
  if (!supabase) return <div className="center-page"><div className="auth-box"><h1>Supabase setup required</h1><p>Put your Supabase URL and anon key in <b>frontend/.env</b>.</p></div></div>;
  if (session) return <Chatbot session={session} />;
  return page === "register" ? <Register onLogin={() => setPage("login")} /> : <Login onRegister={() => setPage("register")} />;
}