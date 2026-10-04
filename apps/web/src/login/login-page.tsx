import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { useShellBrand } from "../lib/frame";
import { HOME_QUERY } from "../lib/queries";
import { LoginScreen } from "./login-screen";

/**
 * The `/login` route: the sign-in form inside the shell's frame, which shows
 * at once and needs no read to stand. Home is read beside it only to learn
 * whether the visitor is signed in already; one who is goes on to `/`, where
 * `HomePage` decides between home, the welcome and the placement.
 */
export function LoginPage(): ReactElement {
  useShellBrand();
  const session = useQuery({ ...HOME_QUERY, refetchOnMount: "always" });
  if (session.isFetchedAfterMount && session.isSuccess) {
    return <Navigate to="/" replace />;
  }
  return <LoginScreen />;
}
