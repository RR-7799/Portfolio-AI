'use client';

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

export default function Dashboard() {
  const [session, setSession] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [mfs, setMfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      window.location.href = "/update-password";
      return;
    }

    setSession(session);

    if (session) {
      loadPortfolio(session.user.id);
    } else {
      setLoading(false);
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);

    if (data.session) {
      loadPortfolio(data.session.user.id);
    } else {
      setLoading(false);
    }
  });

  return () => subscription.unsubscribe();
}, []);
