import { Router, type IRouter } from "express";
import healthRouter from "./health";
import streamRouter from "./stream";
import movieboxRouter from "./moviebox";

const router: IRouter = Router();

router.use(healthRouter);
router.use(streamRouter);
router.use(movieboxRouter);

export default router;
