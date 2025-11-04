import React, { useState, useEffect } from "react";
import Login from "./Login";
import DocumentsList from "./DocumentsList";
import Editor from "./Editor";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(null);
  const [currentDoc, setCurrentDoc] = useState(null);

  useEffect(() => {
    // Listen to hash changes like #open-<docId>
    function handleHashChange() {
      const hash = window.location.hash;
      if (hash.startsWith("#open-")) setCurrentDoc(hash.replace("#open-", ""));
    }
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (!token) {
    return <Login setToken={setToken} setUser={setUser} />;
  }

  if (currentDoc) {
    return <Editor token={token} docId={currentDoc} />;
  }

  return <DocumentsList token={token} />;
}
