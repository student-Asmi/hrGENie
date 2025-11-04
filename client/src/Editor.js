import React, { useEffect, useRef, useState } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { io } from "socket.io-client";
import { api } from "./api";

export default function Editor({ token, docId }) {
  const wrapperRef = useRef();
  const quillRef = useRef();
  const socketRef = useRef();
  const [status, setStatus] = useState("idle");

  console.log("Opened document:", docId);

  // 🔹 Create Quill editor + socket connection once
  useEffect(() => {
    if (!wrapperRef.current) return;

    const editorDiv = document.createElement("div");
    wrapperRef.current.innerHTML = "";
    wrapperRef.current.append(editorDiv);
    const quill = new Quill(editorDiv, { theme: "snow" });
    quillRef.current = quill;

    const socket = io(process.env.REACT_APP_SOCKET_URL || "http://localhost:4000", {
      transports: ["websocket"],
    });
    socketRef.current = socket;

    // Broadcast text changes
    quill.on("text-change", (delta, old, source) => {
      if (source !== "user") return;
      socket.emit("text-change", { docId: docId || "demo-doc", delta });
    });

    // Broadcast cursor position
    quill.on("selection-change", (range) => {
      if (!range) return;
      socket.emit("cursor-move", { docId: docId || "demo-doc", cursor: range });
    });

    // Receive other users' changes
    socket.on("receive-changes", ({ delta }) => {
      quill.updateContents(delta);
    });

    socket.on("cursor-update", ({ socketId, name, cursor }) => {
      console.log("Cursor from:", name, cursor);
    });

    socket.on("doc-load", (content) => {
      if (content && content.html) quill.root.innerHTML = content.html;
    });

    return () => socket.disconnect();
  }, [docId]);

  // 🔹 When docId changes → join room & load from API
  useEffect(() => {
    if (!docId || !socketRef.current || !quillRef.current) return;
    const socket = socketRef.current;
    const quill = quillRef.current;

    socket.emit("join-document", { docId, userName: "You" });

    (async () => {
      try {
        const res = await api.get(`/doc/${docId}`, {
          headers: { Authorization: "Bearer " + token },
        });
        const content = res.data.content;
        if (content && content.html) quill.root.innerHTML = content.html;
      } catch (e) {
        alert("Load failed: " + (e?.response?.data?.error || e.message));
      }
    })();

    const timer = setInterval(async () => {
      try {
        const html = quill.root.innerHTML;
        await api.put(
          `/doc/${docId}`,
          { content: { html } },
          { headers: { Authorization: "Bearer " + token } }
        );
        setStatus("Autosaved " + new Date().toLocaleTimeString());
      } catch {
        setStatus("Save error");
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [docId, token]);

  // 🔹 Manual save
  async function manualSave() {
    try {
      const html = quillRef.current.root.innerHTML;
      await api.put(
        `/doc/${docId}`,
        { content: { html } },
        { headers: { Authorization: "Bearer " + token } }
      );
      setStatus("Saved " + new Date().toLocaleTimeString());
    } catch (e) {
      setStatus("Save failed");
    }
  }

  // 🔹 AI writing assistant
  async function aiImprove() {
    try {
      setStatus("AI calling...");
      const text = quillRef.current.getText();
      const res = await api.post(
        "/ai/enhance",
        { text },
        { headers: { Authorization: "Bearer " + token } }
      );

      const suggestion =
        res.data.improved ||
        res.data.suggestion ||
        JSON.stringify(res.data).slice(0, 500);

      if (
        window.confirm("AI Suggestion:\n\n" + suggestion.slice(0, 500) + "\n\nApply?")
      ) {
        const delta = { ops: [{ insert: "\n" + suggestion + "\n" }] };
        quillRef.current.updateContents(delta);
      }
      setStatus("AI done");
    } catch (e) {
      setStatus("AI failed: " + (e?.response?.data?.error || e.message));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={manualSave}>💾 Save</button>
        <button onClick={aiImprove} style={{ marginLeft: 8 }}>
          🤖 AI Improve
        </button>
        <span style={{ marginLeft: 12 }}>{status}</span>
      </div>
      <div
        ref={wrapperRef}
        style={{ height: "70vh", border: "1px solid #ddd", padding: 8 }}
      />
    </div>
  );
}
