/**
 * @fileoverview Admin Analytics routes — comprehensive statistics for the admin dashboard.
 * All endpoints require superadmin role. All accept ?range=7d|30d|90d|12m|all
 * @module routes/admin-analytics
 */

import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { logger, logDbOperation } from "../services/logger";
import { authenticate, requireSuperAdmin, AuthenticatedRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error-handler";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Parse date range from ?range query param
// ─────────────────────────────────────────────────────────────────────────────

function parseDateRange(range: string): { startDate: Date; prevStartDate: Date; granularity: "day" | "week" | "month" } {
    const now = new Date();
    let startDate: Date;
    let granularity: "day" | "week" | "month" = "day";

    switch (range) {
        case "7d":
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            granularity = "day";
            break;
        case "30d":
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            granularity = "day";
            break;
        case "90d":
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            granularity = "week";
            break;
        case "12m":
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            granularity = "month";
            break;
        case "all":
        default:
            startDate = new Date("2020-01-01");
            granularity = "month";
            break;
    }

    // Previous period of same length for growth rate comparison
    const periodLength = now.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodLength);

    return { startDate, prevStartDate, granularity };
}

function calcGrowthRate(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/overview
// ─────────────────────────────────────────────────────────────────────────────

router.get("/overview", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const { startDate, prevStartDate } = parseDateRange(range);
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ANALYTICS] Overview requested by admin ${adminId}, range=${range}`);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── Totals (all time) ──
    const [
        totalUsers,
        totalConversations,
        totalMessages,
        totalDocuments,
        totalContractSessions,
        totalFileUploads,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.chat.count(),
        prisma.message.count(),
        prisma.generatedDocument.count(),
        prisma.contractSession.count(),
        prisma.userFile.count(),
    ]);

    // ── Period counts for growth ──
    const [
        currentPeriodUsers,
        previousPeriodUsers,
        currentPeriodConversations,
        previousPeriodConversations,
        currentPeriodMessages,
        previousPeriodMessages,
    ] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: startDate } } }),
        prisma.user.count({ where: { createdAt: { gte: prevStartDate, lt: startDate } } }),
        prisma.chat.count({ where: { createdAt: { gte: startDate } } }),
        prisma.chat.count({ where: { createdAt: { gte: prevStartDate, lt: startDate } } }),
        prisma.message.count({ where: { createdAt: { gte: startDate }, role: "user" } }),
        prisma.message.count({ where: { createdAt: { gte: prevStartDate, lt: startDate }, role: "user" } }),
    ]);

    // ── Active Users (DAU/WAU/MAU) using chat.updatedAt as proxy ──
    const [dauChats, wauChats, mauChats] = await Promise.all([
        prisma.chat.findMany({ where: { updatedAt: { gte: startOfToday } }, select: { userId: true }, distinct: ["userId"] }),
        prisma.chat.findMany({ where: { updatedAt: { gte: startOfWeek } }, select: { userId: true }, distinct: ["userId"] }),
        prisma.chat.findMany({ where: { updatedAt: { gte: startOfMonth } }, select: { userId: true }, distinct: ["userId"] }),
    ]);

    // ── Onboarding rate ──
    const onboardedCount = await prisma.user.count({ where: { isOnboarded: true } });
    const onboardingRate = totalUsers > 0 ? (onboardedCount / totalUsers) * 100 : 0;

    // ── Satisfaction (likes/dislikes) ──
    const [totalLikes, totalDislikes] = await Promise.all([
        prisma.message.count({ where: { feedback: "like" } }),
        prisma.message.count({ where: { feedback: "dislike" } }),
    ]);
    const satisfactionRate =
        totalLikes + totalDislikes > 0 ? (totalLikes / (totalLikes + totalDislikes)) * 100 : 0;

    logDbOperation("aggregate", "Analytics/Overview", true, `range=${range}`);

    res.json({
        totalUsers,
        totalConversations,
        totalMessages,
        totalDocuments,
        totalContractSessions,
        totalFileUploads,
        newUsersInPeriod: currentPeriodUsers,
        userGrowthRate: calcGrowthRate(currentPeriodUsers, previousPeriodUsers),
        conversationGrowthRate: calcGrowthRate(currentPeriodConversations, previousPeriodConversations),
        messageGrowthRate: calcGrowthRate(currentPeriodMessages, previousPeriodMessages),
        dau: dauChats.length,
        wau: wauChats.length,
        mau: mauChats.length,
        onboardingRate: Math.round(onboardingRate * 10) / 10,
        totalLikes,
        totalDislikes,
        satisfactionRate: Math.round(satisfactionRate * 10) / 10,
    });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/users/timeseries
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/timeseries", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const { startDate, granularity } = parseDateRange(range);

    let rows: Array<{ date: string; count: bigint }>;

    if (granularity === "day") {
        rows = await prisma.$queryRaw`
            SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as count
            FROM User
            WHERE createdAt >= ${startDate}
            GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
            ORDER BY date ASC
        `;
    } else if (granularity === "week") {
        rows = await prisma.$queryRaw`
            SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') as date, COUNT(*) as count
            FROM User
            WHERE createdAt >= ${startDate}
            GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d')
            ORDER BY date ASC
        `;
    } else {
        rows = await prisma.$queryRaw`
            SELECT DATE_FORMAT(createdAt, '%Y-%m') as date, COUNT(*) as count
            FROM User
            WHERE createdAt >= ${startDate}
            GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
            ORDER BY date ASC
        `;
    }

    const data = rows.map((r) => ({ date: r.date, count: Number(r.count) }));
    res.json({ data, granularity });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/users/marketing-sources
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/marketing-sources", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "all";
    const { startDate } = parseDateRange(range);

    const grouped = await prisma.user.groupBy({
        by: ["marketingSource"],
        _count: { id: true },
        where: range !== "all" ? { createdAt: { gte: startDate } } : undefined,
        orderBy: { _count: { id: "desc" } },
    });

    const total = grouped.reduce((sum, g) => sum + g._count.id, 0);
    const data = grouped.map((g) => ({
        source: g.marketingSource || "Direct / Unknown",
        count: g._count.id,
        percentage: total > 0 ? Math.round((g._count.id / total) * 1000) / 10 : 0,
    }));

    res.json({ data });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/engagement/timeseries
// ─────────────────────────────────────────────────────────────────────────────

router.get("/engagement/timeseries", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const { startDate, granularity } = parseDateRange(range);

    type TsRow = Array<{ date: string; count: bigint }>;
    let msgRows: TsRow;
    let chatRows: TsRow;

    if (granularity === "day") {
        [msgRows, chatRows] = await Promise.all([
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as count
                FROM Message WHERE createdAt >= ${startDate} AND role = 'user'
                GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d') ORDER BY date ASC
            `,
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as count
                FROM Chat WHERE createdAt >= ${startDate}
                GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d') ORDER BY date ASC
            `,
        ]);
    } else if (granularity === "week") {
        [msgRows, chatRows] = await Promise.all([
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') as date, COUNT(*) as count
                FROM Message WHERE createdAt >= ${startDate} AND role = 'user'
                GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') ORDER BY date ASC
            `,
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') as date, COUNT(*) as count
                FROM Chat WHERE createdAt >= ${startDate}
                GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') ORDER BY date ASC
            `,
        ]);
    } else {
        [msgRows, chatRows] = await Promise.all([
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(createdAt, '%Y-%m') as date, COUNT(*) as count
                FROM Message WHERE createdAt >= ${startDate} AND role = 'user'
                GROUP BY DATE_FORMAT(createdAt, '%Y-%m') ORDER BY date ASC
            `,
            prisma.$queryRaw<TsRow>`
                SELECT DATE_FORMAT(createdAt, '%Y-%m') as date, COUNT(*) as count
                FROM Chat WHERE createdAt >= ${startDate}
                GROUP BY DATE_FORMAT(createdAt, '%Y-%m') ORDER BY date ASC
            `,
        ]);
    }

    // Merge into single array by date
    const dateSet = new Set([
        ...msgRows.map((r) => r.date),
        ...chatRows.map((r) => r.date),
    ]);
    const msgMap = new Map(msgRows.map((r) => [r.date, Number(r.count)]));
    const chatMap = new Map(chatRows.map((r) => [r.date, Number(r.count)]));

    const data = Array.from(dateSet)
        .sort()
        .map((date) => ({
            date,
            messages: msgMap.get(date) || 0,
            conversations: chatMap.get(date) || 0,
        }));

    res.json({ data, granularity });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/engagement/activity-heatmap
// ─────────────────────────────────────────────────────────────────────────────

router.get("/engagement/activity-heatmap", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const { startDate } = parseDateRange(range);

    // Use explicit expressions in GROUP BY (avoid aliases + reserved words in ORDER BY).
    // Sort result in JS after fetching.
    const rows: Array<{ dow: number; hr: number; cnt: bigint }> = await prisma.$queryRaw`
        SELECT
            (DAYOFWEEK(createdAt) - 1)  AS dow,
            HOUR(createdAt)             AS hr,
            COUNT(*)                    AS cnt
        FROM Message
        WHERE role = 'user' AND createdAt >= ${startDate}
        GROUP BY (DAYOFWEEK(createdAt) - 1), HOUR(createdAt)
    `;

    const data = rows
        .map((r) => ({
            dayOfWeek: Number(r.dow),
            hour:      Number(r.hr),
            count:     Number(r.cnt),
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);

    res.json({ data });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/engagement/depth
// ─────────────────────────────────────────────────────────────────────────────

router.get("/engagement/depth", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "all";
    const { startDate } = parseDateRange(range);

    // Get per-user message counts (always all-time for depth analysis)
    const perUserRows: Array<{ userId: string; msgCount: bigint; chatCount: bigint }> = await prisma.$queryRaw`
        SELECT
            u.id AS userId,
            COUNT(DISTINCT m.id) AS msgCount,
            COUNT(DISTINCT c.id) AS chatCount
        FROM User u
        LEFT JOIN Chat c ON c.userId = u.id
        LEFT JOIN Message m ON m.chatId = c.id AND m.role = 'user'
        GROUP BY u.id
    `;

    const msgCounts = perUserRows.map((r) => Number(r.msgCount));
    const chatCounts = perUserRows.map((r) => Number(r.chatCount));

    const totalUsers = msgCounts.length;
    const totalMsgs = msgCounts.reduce((s, c) => s + c, 0);
    const totalChats = chatCounts.reduce((s, c) => s + c, 0);
    const avgMessagesPerUser = totalUsers > 0 ? Math.round((totalMsgs / totalUsers) * 10) / 10 : 0;
    const avgConversationsPerUser = totalUsers > 0 ? Math.round((totalChats / totalUsers) * 10) / 10 : 0;

    const sorted = [...msgCounts].sort((a, b) => a - b);
    const medianMessagesPerUser = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

    // Bucket distribution
    const buckets: Record<string, number> = {
        "0": 0,
        "1-5": 0,
        "6-10": 0,
        "11-25": 0,
        "26-50": 0,
        "51-100": 0,
        "100+": 0,
    };
    for (const c of msgCounts) {
        if (c === 0) buckets["0"]++;
        else if (c <= 5) buckets["1-5"]++;
        else if (c <= 10) buckets["6-10"]++;
        else if (c <= 25) buckets["11-25"]++;
        else if (c <= 50) buckets["26-50"]++;
        else if (c <= 100) buckets["51-100"]++;
        else buckets["100+"]++;
    }

    const distribution = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

    res.json({ avgMessagesPerUser, avgConversationsPerUser, medianMessagesPerUser, distribution });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/engagement/power-users
// ─────────────────────────────────────────────────────────────────────────────

router.get("/engagement/power-users", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            chats: {
                select: {
                    updatedAt: true,
                    _count: { select: { messages: true } },
                },
            },
            _count: { select: { chats: true } },
        },
    });

    const usersWithStats = users.map((u) => {
        const messageCount = u.chats.reduce((sum, c) => sum + c._count.messages, 0);
        const lastActive = u.chats.length > 0
            ? new Date(Math.max(...u.chats.map((c) => new Date(c.updatedAt).getTime()))).toISOString()
            : null;
        return {
            id: u.id,
            email: u.email,
            name: u.name,
            messageCount,
            conversationCount: u._count.chats,
            lastActive,
        };
    });

    const topUsers = usersWithStats
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 20);

    res.json({ users: topUsers });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/content/overview
// ─────────────────────────────────────────────────────────────────────────────

router.get("/content/overview", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const range = (req.query.range as string) || "30d";
    const { startDate, granularity } = parseDateRange(range);
    const whereClause = range !== "all" ? { createdAt: { gte: startDate } } : undefined;

    // ── Contracts ──
    const [contractTotal, contractByType, contractByLanguage, contractByStatus] = await Promise.all([
        prisma.contractSession.count({ where: whereClause }),
        prisma.contractSession.groupBy({ by: ["contractType"], _count: { id: true }, where: whereClause, orderBy: { _count: { id: "desc" } } }),
        prisma.contractSession.groupBy({ by: ["language"], _count: { id: true }, where: whereClause }),
        prisma.contractSession.groupBy({ by: ["status"], _count: { id: true }, where: whereClause }),
    ]);

    let contractTimeseries: Array<{ date: string; count: bigint }>;
    if (granularity === "day") {
        contractTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m-%d') as date, COUNT(*) as count FROM ContractSession WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m-%d') ORDER BY 1 ASC`;
    } else if (granularity === "week") {
        contractTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') as date, COUNT(*) as count FROM ContractSession WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') ORDER BY 1 ASC`;
    } else {
        contractTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m') as date, COUNT(*) as count FROM ContractSession WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m') ORDER BY 1 ASC`;
    }

    // ── Documents ──
    const [docTotal, docByType] = await Promise.all([
        prisma.generatedDocument.count({ where: whereClause }),
        prisma.generatedDocument.groupBy({ by: ["type"], _count: { id: true }, where: whereClause, orderBy: { _count: { id: "desc" } } }),
    ]);

    let docTimeseries: Array<{ date: string; count: bigint }>;
    if (granularity === "day") {
        docTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m-%d') as date, COUNT(*) as count FROM GeneratedDocument WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m-%d') ORDER BY 1 ASC`;
    } else if (granularity === "week") {
        docTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') as date, COUNT(*) as count FROM GeneratedDocument WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') ORDER BY 1 ASC`;
    } else {
        docTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m') as date, COUNT(*) as count FROM GeneratedDocument WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m') ORDER BY 1 ASC`;
    }

    // ── Files ──
    const [fileTotal, fileByMimetype, fileSizeAgg] = await Promise.all([
        prisma.userFile.count({ where: whereClause }),
        prisma.userFile.groupBy({ by: ["mimetype"], _count: { id: true }, where: whereClause, orderBy: { _count: { id: "desc" } } }),
        prisma.userFile.aggregate({ _sum: { size: true }, where: whereClause }),
    ]);

    let fileTimeseries: Array<{ date: string; count: bigint }>;
    if (granularity === "day") {
        fileTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m-%d') as date, COUNT(*) as count FROM UserFile WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m-%d') ORDER BY 1 ASC`;
    } else if (granularity === "week") {
        fileTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') as date, COUNT(*) as count FROM UserFile WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY),'%Y-%m-%d') ORDER BY 1 ASC`;
    } else {
        fileTimeseries = await prisma.$queryRaw`SELECT DATE_FORMAT(createdAt,'%Y-%m') as date, COUNT(*) as count FROM UserFile WHERE createdAt >= ${startDate} GROUP BY DATE_FORMAT(createdAt,'%Y-%m') ORDER BY 1 ASC`;
    }

    // ── Feedback ──
    const [feedbackLikes, feedbackDislikes] = await Promise.all([
        prisma.message.count({ where: { feedback: "like", createdAt: whereClause?.createdAt } }),
        prisma.message.count({ where: { feedback: "dislike", createdAt: whereClause?.createdAt } }),
    ]);

    let feedbackRows: Array<{ date: string; likes: bigint; dislikes: bigint }>;
    if (granularity === "day") {
        feedbackRows = await prisma.$queryRaw`
            SELECT DATE_FORMAT(createdAt,'%Y-%m-%d') as date,
                SUM(CASE WHEN feedback='like' THEN 1 ELSE 0 END) as likes,
                SUM(CASE WHEN feedback='dislike' THEN 1 ELSE 0 END) as dislikes
            FROM Message WHERE feedback IS NOT NULL AND createdAt >= ${startDate}
            GROUP BY DATE_FORMAT(createdAt,'%Y-%m-%d') ORDER BY 1 ASC
        `;
    } else {
        feedbackRows = await prisma.$queryRaw`
            SELECT DATE_FORMAT(createdAt,'%Y-%m') as date,
                SUM(CASE WHEN feedback='like' THEN 1 ELSE 0 END) as likes,
                SUM(CASE WHEN feedback='dislike' THEN 1 ELSE 0 END) as dislikes
            FROM Message WHERE feedback IS NOT NULL AND createdAt >= ${startDate}
            GROUP BY DATE_FORMAT(createdAt,'%Y-%m') ORDER BY 1 ASC
        `;
    }

    // ── Feature adoption ──
    const totalUsers = await prisma.user.count();
    const [chatUsers, contractUsers, fileUsers, docUsers] = await Promise.all([
        prisma.chat.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.contractSession.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.userFile.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.generatedDocument.findMany({ select: { userId: true }, distinct: ["userId"] }),
    ]);

    const pct = (n: number) => totalUsers > 0 ? Math.round((n / totalUsers) * 1000) / 10 : 0;

    logDbOperation("aggregate", "Analytics/Content", true, `range=${range}`);

    res.json({
        contracts: {
            total: contractTotal,
            byType: contractByType.map((r) => ({ type: r.contractType, count: r._count.id })),
            byLanguage: contractByLanguage.map((r) => ({ language: r.language, count: r._count.id })),
            byStatus: contractByStatus.map((r) => ({ status: r.status, count: r._count.id })),
            timeseries: contractTimeseries.map((r) => ({ date: r.date, count: Number(r.count) })),
        },
        documents: {
            total: docTotal,
            byType: docByType.map((r) => ({ type: r.type, count: r._count.id })),
            timeseries: docTimeseries.map((r) => ({ date: r.date, count: Number(r.count) })),
        },
        files: {
            total: fileTotal,
            totalSizeBytes: fileSizeAgg._sum.size || 0,
            byMimetype: fileByMimetype.map((r) => ({ mimetype: r.mimetype, count: r._count.id })),
            timeseries: fileTimeseries.map((r) => ({ date: r.date, count: Number(r.count) })),
        },
        feedback: {
            totalLikes: feedbackLikes,
            totalDislikes: feedbackDislikes,
            rateOverTime: feedbackRows.map((r) => ({
                date: r.date,
                likes: Number(r.likes),
                dislikes: Number(r.dislikes),
            })),
        },
        featureAdoption: {
            chatUsersPercent: pct(chatUsers.length),
            contractUsersPercent: pct(contractUsers.length),
            fileUploadUsersPercent: pct(fileUsers.length),
            docGenUsersPercent: pct(docUsers.length),
        },
    });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/retention/cohorts
// ─────────────────────────────────────────────────────────────────────────────

router.get("/retention/cohorts", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const adminId = (req as AuthenticatedRequest).userId;
    logger.info(`[ANALYTICS] Cohort retention requested by admin ${adminId}`);

    // Step 1: Get all users with their signup month
    const users = await prisma.user.findMany({
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });

    if (users.length === 0) {
        return res.json({ cohorts: [] });
    }

    // Step 2: Get all activity (user messages) with their month
    const activityRows: Array<{ userId: string; activeMonth: string }> = await prisma.$queryRaw`
        SELECT DISTINCT c.userId, DATE_FORMAT(m.createdAt, '%Y-%m') as activeMonth
        FROM Message m
        JOIN Chat c ON m.chatId = c.id
        WHERE m.role = 'user'
    `;

    // Build activity lookup: userId -> Set<activeMonth>
    const activityMap = new Map<string, Set<string>>();
    for (const row of activityRows) {
        if (!activityMap.has(row.userId)) activityMap.set(row.userId, new Set());
        activityMap.get(row.userId)!.add(row.activeMonth);
    }

    // Step 3: Group users by cohort month
    const cohortMap = new Map<string, string[]>();
    for (const user of users) {
        const cohortMonth = user.createdAt.toISOString().slice(0, 7); // "YYYY-MM"
        if (!cohortMap.has(cohortMonth)) cohortMap.set(cohortMonth, []);
        cohortMap.get(cohortMonth)!.push(user.id);
    }

    // Step 4: Compute retention for each cohort
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const cohorts = Array.from(cohortMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohortMonth, userIds]) => {
            const [cy, cm] = cohortMonth.split("-").map(Number);
            const retention: Array<{ monthOffset: number; activeUsers: number; retentionRate: number }> = [];

            // Calculate retention for each subsequent month until now
            let offset = 0;
            let yearMonth = cohortMonth;

            while (yearMonth <= currentYearMonth) {
                const activeCount = userIds.filter((uid) => {
                    const activity = activityMap.get(uid);
                    return activity?.has(yearMonth);
                }).length;

                retention.push({
                    monthOffset: offset,
                    activeUsers: activeCount,
                    retentionRate: userIds.length > 0 ? Math.round((activeCount / userIds.length) * 1000) / 10 : 0,
                });

                offset++;
                // Advance to next month
                const nextMonth = (cm - 1 + offset) % 12;
                const nextYear = cy + Math.floor((cm - 1 + offset) / 12);
                yearMonth = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
            }

            return {
                cohortMonth,
                totalUsers: userIds.length,
                retention,
            };
        });

    res.json({ cohorts });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/retention/rates
// ─────────────────────────────────────────────────────────────────────────────

router.get("/retention/rates", authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const now = new Date();

    // Day-N retention: of users who signed up at least N days ago,
    // how many sent a message on or after day N of their signup?
    const calcRetention = async (days: number) => {
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        // Users who signed up before the cutoff (eligible)
        const eligibleUsers = await prisma.user.findMany({
            where: { createdAt: { lte: cutoff } },
            select: { id: true, createdAt: true },
        });

        if (eligibleUsers.length === 0) return { eligible: 0, retained: 0, rate: 0 };

        // For each user, check if they sent a message >= (createdAt + days)
        let retained = 0;
        for (const u of eligibleUsers) {
            const retentionDate = new Date(u.createdAt.getTime() + days * 24 * 60 * 60 * 1000);
            const msg = await prisma.message.findFirst({
                where: {
                    role: "user",
                    createdAt: { gte: retentionDate },
                    chat: { userId: u.id },
                },
                select: { id: true },
            });
            if (msg) retained++;
        }

        return {
            eligible: eligibleUsers.length,
            retained,
            rate: Math.round((retained / eligibleUsers.length) * 1000) / 10,
        };
    };

    // Run Day-1, Day-7, Day-30 in parallel
    const [day1, day7, day30] = await Promise.all([
        calcRetention(1),
        calcRetention(7),
        calcRetention(30),
    ]);

    // Churn rate: users who were active in 31-60 days ago but NOT in last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const previouslyActive = await prisma.chat.findMany({
        where: { updatedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        select: { userId: true },
        distinct: ["userId"],
    });

    const recentlyActive = await prisma.chat.findMany({
        where: { updatedAt: { gte: thirtyDaysAgo } },
        select: { userId: true },
        distinct: ["userId"],
    });

    const recentIds = new Set(recentlyActive.map((c) => c.userId));
    const churned = previouslyActive.filter((c) => !recentIds.has(c.userId)).length;
    const churnRate = previouslyActive.length > 0
        ? Math.round((churned / previouslyActive.length) * 1000) / 10
        : 0;

    logDbOperation("aggregate", "Analytics/Retention", true, "retention rates computed");

    res.json({ day1, day7, day30, churnRate });
}));

export default router;
