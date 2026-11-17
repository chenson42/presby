"use client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import { useEffect, useRef } from "react";

export default function Map() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const m = L.map(ref.current).setView([39.96, -82.99], 10);
    return () => { m.remove(); };
  }, []);
  return <div ref={ref} className="presby-map h-72" />;
}
