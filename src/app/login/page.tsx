import { Suspense } from "react";
import LoginForm from "./ui";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
