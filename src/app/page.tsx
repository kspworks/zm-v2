import { redirect } from "next/navigation";

import { HOME_PATH } from "~/lib/auth-routing";

export default function Home() {
  redirect(HOME_PATH);
}
