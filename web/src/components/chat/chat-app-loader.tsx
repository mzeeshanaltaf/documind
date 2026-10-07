"use client";

import dynamic from "next/dynamic";
import { ChatSkeleton } from "./chat-skeleton";

// Client-only: the chat mints ids and reads browser APIs while it sets up (global hydration rule).
export const ChatAppLoader = dynamic(() => import("./chat-app").then((m) => m.ChatApp), {
  ssr: false,
  loading: () => <ChatSkeleton />,
});
