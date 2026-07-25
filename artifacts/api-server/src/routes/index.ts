import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaguesRouter from "./leagues";
import competitionRouter from "./competition";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(leaguesRouter);
router.use(competitionRouter);

export default router;
