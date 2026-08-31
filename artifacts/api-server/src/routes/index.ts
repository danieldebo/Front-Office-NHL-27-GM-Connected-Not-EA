import { Router, type IRouter } from "express";
import healthRouter from "./health";
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
import dqRouter from "./dq";
import usersRouter from "./users";
import leagueSettingsRouter from "./league-settings";
import xboxLinkRouter from "./xbox-link";
import transactionsRouter from "./transactions";
import keepersRouter from "./keepers";
import boxScoresRouter from "./box-scores";
import digestRouter from "./digest";
import calendarFeedRouter from "./calendar-feed";
import partnersRouter from "./partners";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(discoveryRouter);   // before leaguesRouter — /leagues/open must not match /leagues/:leagueId
router.use(leaguesRouter);
router.use(leaguesManageRouter);
router.use(leagueSettingsRouter);
router.use(seatsRouter);
router.use(rulebookRouter);
router.use(competitionRouter);
router.use(scheduleRouter);
router.use(availabilityRouter);
router.use(commissionerLinksRouter);
router.use(featureRequestsRouter);
router.use(dqRouter);
router.use(xboxLinkRouter);
router.use(transactionsRouter);
router.use(keepersRouter);
router.use(boxScoresRouter);
router.use(digestRouter);
router.use(calendarFeedRouter);
router.use(partnersRouter);

export default router;
