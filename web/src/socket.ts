import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ["polling", "websocket"],
      upgrade: true,
    });
  }
  return socket;
}
