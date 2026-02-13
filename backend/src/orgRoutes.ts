import { Router } from "express";
import { AuthRequest } from "./auth";
import { getUserOrgs } from "./orgs";

const router = Router();

router.get("/orgs", async (req: AuthRequest, res) => {
  const orgs = await getUserOrgs(req.user!.id);
  res.json(orgs);
});

export default router;
