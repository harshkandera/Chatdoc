"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { Settings, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";

export default function UserDropdown() {
  const { signOut, openUserProfile } = useClerk();
  const { user, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!isLoaded || !user) return null;

  return (
    <div ref={ref} className="relative">
      {/* Avatar trigger */}
      <button onClick={() => setOpen(!open)}>
        <Image
          src={user.imageUrl}
          alt="avatar"
          width={32}
          height={32}
          className="rounded-full mt-1"
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] rounded-2xl bg-black border border-white/10 shadow-2xl p-5">
          {/* User info */}
          <div className="flex items-center gap-4 mb-6">
            <Image
              src={user.imageUrl}
              alt="avatar"
              width={36}
              height={36}
              className="rounded-full"
            />
            <div>
              <p className="text-white text-md font-medium">
                {user.fullName}
              </p>
              <p className="text-neutral-400 text-xs">
                {user.primaryEmailAddress?.emailAddress}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-4">
            <button
              onClick={() => {
                openUserProfile();
                setOpen(false);
              }}
              className="flex items-center gap-4 text-neutral-300 hover:text-white"
            >
              <Settings className="w-4 h-4 font-semibold" />
              <span className="text-sm font-semibold">Settings</span>
            </button>

            <button
              onClick={() => signOut({ redirectUrl: "/" })}
              className="flex items-center gap-4 text-neutral-300 hover:text-white"
            >
              <LogOut className="w-4 h-4 font-semibold" />
              <span className="text-sm font-semibold">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
