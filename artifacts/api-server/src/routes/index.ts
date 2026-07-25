import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaguesRouter from "./leagues";
import leaguesManageRouter from "./leagues-manage";
import seatsRouter from "./seats";
import rulebookRouter from "./rulebook";
import competitionRouter from "./competition";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(leaguesRouter);
router.use(leaguesManageRouter);
router.use(seatsRouter);
router.use(rulebookRouter);
router.use(competitionRouter);

export default router;
