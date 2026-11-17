"use client";
import dynamic from "next/dynamic";
const Map = dynamic(() => import("./map"), { ssr: false, loading: () => <div className="h-72" /> });
export function ViabilityMapLoader() { return <Map />; }
