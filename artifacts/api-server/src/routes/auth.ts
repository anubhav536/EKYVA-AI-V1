import { Router, type IRouter } from "express";
import { LoginBody, RegisterBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/v1/auth/register", (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  res.status(501).json({
    error: "Account creation is managed by Clerk Auth. Use the hosted sign-up flow.",
    code: "CLERK_MANAGED_AUTH",
  });
});

router.post("/v1/auth/login", (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  res.status(501).json({
    error: "Sign-in is managed by Clerk Auth. Use the hosted sign-in flow.",
    code: "CLERK_MANAGED_AUTH",
  });
});

export default router;