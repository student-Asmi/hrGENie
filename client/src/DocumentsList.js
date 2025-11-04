import React, { useEffect, useState } from "react";
import { api } from "./api";

export default function DocumentsList({ token }) {
  const [docs, setDocs] = useState([]);
  useEffect(() => { fetchDocs(); }, []);
  async function fetchDocs() {
    try {
      const res = await api.get("/documents", { headers: { Authorization: "Bearer " + token } });
      setDocs(res.data);
    } catch (e) { console.error(e); }
  }
  async function createDoc() {
    const res = await api.post("/doc", { title: "New Document" }, { headers: { Authorization: "Bearer " + token } });
    setDocs([res.data, ...docs]);
  }
  return (
    <div>
      <button onClick={createDoc}>+ New</button>
      <h4>Your Documents</h4>
      <ul>
        {docs.map(d => (
          <li key={d._id}>
            <a href={"#open-" + d._id}
             onClick={(ev) => {
               ev.preventDefault();
                window.location.hash = `open-${d._id}`;
                 window.dispatchEvent(new HashChangeEvent("hashchange"));
                  }}>
              {d.title || "Untitled"}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
