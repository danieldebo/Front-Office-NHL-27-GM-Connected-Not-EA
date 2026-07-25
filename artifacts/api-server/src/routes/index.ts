import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaguesRouter from "./leagues";
import leaguesManageRouter from "./leagues-manage";
import seatsRouter from "./seats";
import rulebookRouter from "./rulebook";
import competitionRouter from "./competition";
import scheduleRouter from "./schedule";
import availabilityRouter from "./availability";
import commissionerLinksRouter from "./commissioner-links";
import discoveryRouter from "./discovery";
import featureRequestsRouter from "./feature-requests";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(discoveryRouter);   // before leaguesRouter — /leagues/open must not match /leagues/:leagueId
router.use(leaguesRouter);
router.use(leaguesManageRouter);
router.use(seatsRouter);
router.use(rulebookRouter);
router.use(competitionRouter);
router.use(scheduleRouter);
router.use(availabilityRouter);
router.use(commissionerLinksRouter);
router.use(featureRequestsRouter);

export default router;
