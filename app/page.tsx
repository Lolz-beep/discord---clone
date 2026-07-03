import AppShell from "@/components/AppShell";

// The page itself is a Server Component; everything interactive (WebSocket,
// getUserMedia, RTCPeerConnection) lives in Client Components under AppShell.
export default function Home() {
  return <AppShell />;
}
