"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { firebaseAuth, db } from "@/lib/firebase/client";

export type SessionProfile = {
  display_name: string | null;
  role: string | null;
};

export type AppUser = FirebaseUser & { id: string };

export type UseSessionResult =
  | { status: "loading"; user: null; profile: null }
  | { status: "unauthenticated"; user: null; profile: null }
  | { status: "ready"; user: AppUser; profile: SessionProfile };

export function useSession(options: { redirectTo?: string; requiredRole?: string[] } = {}): UseSessionResult {
  const router = useRouter();
  const [result, setResult] = useState<UseSessionResult>({ status: "loading", user: null, profile: null });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        setResult({ status: "unauthenticated", user: null, profile: null });
        const loginUrl = options.redirectTo
          ? `/login?redirect=${encodeURIComponent(options.redirectTo)}`
          : "/login";
        router.replace(loginUrl);
        return;
      }

      try {
        const profileSnap = await getDoc(doc(db, "users", firebaseUser.uid));
        const profileData = profileSnap.data() as { display_name?: string; role?: string } | undefined;
        const role = profileData?.role ?? null;

        if (options.requiredRole && options.requiredRole.length > 0) {
          if (!role || !options.requiredRole.includes(role)) {
            router.replace("/training");
            return;
          }
        }

        const user = Object.assign(firebaseUser, { id: firebaseUser.uid }) as AppUser;
        setResult({
          status: "ready",
          user,
          profile: { display_name: profileData?.display_name ?? null, role },
        });
      } catch {
        setResult({ status: "unauthenticated", user: null, profile: null });
      }
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
