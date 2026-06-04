import { redirect } from "next/navigation";

// Auth state is resolved by middleware (src/middleware.ts): unauthenticated
// visitors are sent to /login before this runs; authenticated ones land on /home.
export default function Index() {
  redirect("/home");
}
