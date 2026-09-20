import { PasswordResetEmail } from "~/server/mail/templates";

const Preview = () => (
  <PasswordResetEmail
    locale="uk"
    name="Олена"
    url="https://zm.example.org/reset-password?token=preview-token"
  />
);

export default Preview;
