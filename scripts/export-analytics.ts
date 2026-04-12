/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 9anon Analytics Data Exporter
 * ─────────────────────────────────────────────────────────────────────────────
 * Exports ALL platform analytics as clean numerical data for AI analysis.
 * No personal data is included (no emails, names, message content, user IDs).
 *
 * Run:
 *   npx ts-node scripts/export-analytics.ts
 *
 * Output:
 *   analytics-export-YYYY-MM-DD.json   — full structured data for AI
 *   analytics-report-YYYY-MM-DD.md     — human-readable summary
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(part: number, total: number, decimals = 1): number {
    if (total === 0) return 0;
    return Math.round((part / total) * Math.pow(10, decimals + 2)) / Math.pow(10, decimals);
}

function round(n: number, decimals = 1): number {
    return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function calcGrowthRate(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return round(((current - previous) / previous) * 100);
}

function getDateRange(daysBack: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d;
}

function formatYearMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
}

// ─── Section collectors ───────────────────────────────────────────────────────

async function collectUserMetrics() {
    console.log("  → User metrics...");
    const now = new Date();

    const [totalUsers, onboardedUsers, feedbackDismissed] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isOnboarded: true } }),
        prisma.user.count({ where: { feedbackDismissed: true } }),
    ]);

    // Monthly registrations (all time)
    const monthlyRows: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM User
        GROUP BY month
        ORDER BY month ASC
    `;

    // Marketing source breakdown (counts only, no source names if sensitive — kept as-is since it's traffic source not PII)
    const sourcesRaw = await prisma.user.groupBy({
        by: ["marketingSource"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
    });

    // Role distribution
    const rolesRaw = await prisma.user.groupBy({
        by: ["role"],
        _count: { id: true },
    });

    // New users in periods
    const [new7d, new30d, new90d, new12m] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: getDateRange(7) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(30) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(90) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(365) } } }),
    ]);

    // Previous period for growth rates
    const [prev7d, prev30d, prev90d, prev12m] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: getDateRange(14), lt: getDateRange(7) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(60), lt: getDateRange(30) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(180), lt: getDateRange(90) } } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(730), lt: getDateRange(365) } } }),
    ]);

    return {
        totals: {
            total: totalUsers,
            onboarded: onboardedUsers,
            notOnboarded: totalUsers - onboardedUsers,
            onboardingRate: pct(onboardedUsers, totalUsers),
            feedbackDismissed,
            feedbackDismissedRate: pct(feedbackDismissed, totalUsers),
        },
        roles: rolesRaw.map((r) => ({
            role: r.role,
            count: r._count.id,
            percentage: pct(r._count.id, totalUsers),
        })),
        marketingSources: sourcesRaw.map((s) => ({
            source: s.marketingSource ?? "Direct / Unknown",
            count: s._count.id,
            percentage: pct(s._count.id, totalUsers),
        })),
        growthByPeriod: {
            last7Days: { newUsers: new7d, growthRate: calcGrowthRate(new7d, prev7d) },
            last30Days: { newUsers: new30d, growthRate: calcGrowthRate(new30d, prev30d) },
            last90Days: { newUsers: new90d, growthRate: calcGrowthRate(new90d, prev90d) },
            last12Months: { newUsers: new12m, growthRate: calcGrowthRate(new12m, prev12m) },
        },
        monthlyRegistrations: monthlyRows.map((r) => ({
            month: r.month,
            newUsers: Number(r.count),
        })),
    };
}

async function collectEngagementMetrics() {
    console.log("  → Engagement metrics...");

    const [totalChats, totalMessages, totalUserMessages] = await Promise.all([
        prisma.chat.count(),
        prisma.message.count(),
        prisma.message.count({ where: { role: "user" } }),
    ]);

    const totalUsers = await prisma.user.count();

    // Monthly messages & conversations
    const monthlyMessages: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM Message WHERE role = 'user'
        GROUP BY month ORDER BY month ASC
    `;
    const monthlyChats: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM Chat
        GROUP BY month ORDER BY month ASC
    `;

    // Activity heatmap (day of week × hour)
    const heatmapRows: Array<{ dow: number; hour: number; count: bigint }> = await prisma.$queryRaw`
        SELECT
            DAYOFWEEK(createdAt) - 1 AS dow,
            HOUR(createdAt) AS hour,
            COUNT(*) AS count
        FROM Message
        WHERE role = 'user'
        GROUP BY dow, hour
        ORDER BY dow, hour
    `;

    // Per-user message distribution
    const perUser: Array<{ msgCount: bigint }> = await prisma.$queryRaw`
        SELECT COUNT(m.id) AS msgCount
        FROM User u
        LEFT JOIN Chat c ON c.userId = u.id
        LEFT JOIN Message m ON m.chatId = c.id AND m.role = 'user'
        GROUP BY u.id
    `;

    const counts = perUser.map((r) => Number(r.msgCount));
    const sorted = [...counts].sort((a, b) => a - b);
    const total = counts.reduce((s, c) => s + c, 0);
    const avg = totalUsers > 0 ? round(total / totalUsers) : 0;
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const p90 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] : 0;
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;

    const buckets: Record<string, number> = {
        "0 messages": 0,
        "1-5 messages": 0,
        "6-10 messages": 0,
        "11-25 messages": 0,
        "26-50 messages": 0,
        "51-100 messages": 0,
        "101-250 messages": 0,
        "251+ messages": 0,
    };
    for (const c of counts) {
        if (c === 0) buckets["0 messages"]++;
        else if (c <= 5) buckets["1-5 messages"]++;
        else if (c <= 10) buckets["6-10 messages"]++;
        else if (c <= 25) buckets["11-25 messages"]++;
        else if (c <= 50) buckets["26-50 messages"]++;
        else if (c <= 100) buckets["51-100 messages"]++;
        else if (c <= 250) buckets["101-250 messages"]++;
        else buckets["251+ messages"]++;
    }

    // Per-conversation distribution
    const perUserChats: Array<{ chatCount: bigint }> = await prisma.$queryRaw`
        SELECT COUNT(c.id) AS chatCount
        FROM User u
        LEFT JOIN Chat c ON c.userId = u.id
        GROUP BY u.id
    `;
    const chatCounts = perUserChats.map((r) => Number(r.chatCount));
    const avgChats = totalUsers > 0 ? round(chatCounts.reduce((s, c) => s + c, 0) / totalUsers) : 0;
    const sortedChats = [...chatCounts].sort((a, b) => a - b);
    const medianChats = sortedChats.length > 0 ? sortedChats[Math.floor(sortedChats.length / 2)] : 0;

    // Active users
    const now = new Date();
    const [dau, wau, mau] = await Promise.all([
        prisma.chat.findMany({ where: { updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } }, select: { userId: true }, distinct: ["userId"] }),
        prisma.chat.findMany({ where: { updatedAt: { gte: getDateRange(7) } }, select: { userId: true }, distinct: ["userId"] }),
        prisma.chat.findMany({ where: { updatedAt: { gte: getDateRange(30) } }, select: { userId: true }, distinct: ["userId"] }),
    ]);

    // Message regeneration (versioning)
    const regeneratedMessages = await prisma.message.count({ where: { version: { gt: 1 } } });
    const pinnedChats = await prisma.chat.count({ where: { isPinned: true } });

    // Top power users by message count — NO emails/names, just rank + numbers
    const powerUsersRaw = await prisma.user.findMany({
        select: {
            chats: {
                select: {
                    updatedAt: true,
                    _count: { select: { messages: true } },
                },
            },
            _count: { select: { chats: true } },
        },
    });

    const powerUserStats = powerUsersRaw
        .map((u) => ({
            messageCount: u.chats.reduce((s, c) => s + c._count.messages, 0),
            conversationCount: u._count.chats,
        }))
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 20)
        .map((u, i) => ({ rank: i + 1, ...u }));

    return {
        totals: {
            totalConversations: totalChats,
            totalMessages,
            totalUserMessages,
            totalAssistantMessages: totalMessages - totalUserMessages,
            pinnedConversations: pinnedChats,
            regeneratedMessages,
            regenerationRate: pct(regeneratedMessages, totalUserMessages),
        },
        activeUsers: {
            dau: dau.length,
            wau: wau.length,
            mau: mau.length,
            dauToMauRatio: mau.length > 0 ? round(dau.length / mau.length * 100) : 0,
            wauToMauRatio: mau.length > 0 ? round(wau.length / mau.length * 100) : 0,
        },
        perUserStats: {
            avgMessagesPerUser: avg,
            medianMessagesPerUser: median,
            p90MessagesPerUser: p90,
            p95MessagesPerUser: p95,
            avgConversationsPerUser: avgChats,
            medianConversationsPerUser: medianChats,
            avgMessagesPerConversation: totalChats > 0 ? round(totalUserMessages / totalChats) : 0,
        },
        engagementDepthDistribution: Object.entries(buckets).map(([bucket, count]) => ({
            bucket,
            userCount: count,
            percentage: pct(count, totalUsers),
        })),
        powerUsers: {
            note: "Top 20 most active users — no identifying information included",
            users: powerUserStats,
        },
        monthlyActivity: (() => {
            const msgMap = new Map(monthlyMessages.map((r) => [r.month, Number(r.count)]));
            const chatMap = new Map(monthlyChats.map((r) => [r.month, Number(r.count)]));
            const months = new Set([...msgMap.keys(), ...chatMap.keys()]);
            return Array.from(months).sort().map((m) => ({
                month: m,
                userMessages: msgMap.get(m) ?? 0,
                newConversations: chatMap.get(m) ?? 0,
            }));
        })(),
        activityHeatmap: {
            description: "Message counts by day-of-week (0=Sun…6=Sat) and hour (0-23 UTC)",
            data: heatmapRows.map((r) => ({
                dayOfWeek: Number(r.dow),
                hour: Number(r.hour),
                messageCount: Number(r.count),
            })),
        },
    };
}

async function collectRetentionMetrics() {
    console.log("  → Retention metrics...");
    const now = new Date();

    // ── Day-N retention ──
    const calcDayNRetention = async (days: number) => {
        const cutoff = getDateRange(days);
        const eligible = await prisma.user.findMany({
            where: { createdAt: { lte: cutoff } },
            select: { id: true, createdAt: true },
        });

        if (eligible.length === 0) return { eligible: 0, retained: 0, rate: 0 };

        // For each eligible user: check if they sent a message after day N of signup
        let retained = 0;
        for (const u of eligible) {
            const retentionDate = new Date(u.createdAt.getTime() + days * 86400000);
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
            eligible: eligible.length,
            retained,
            rate: pct(retained, eligible.length),
        };
    };

    console.log("    Computing Day-1 retention...");
    const day1 = await calcDayNRetention(1);
    console.log("    Computing Day-7 retention...");
    const day7 = await calcDayNRetention(7);
    console.log("    Computing Day-30 retention...");
    const day30 = await calcDayNRetention(30);

    // ── Monthly churn ──
    const previouslyActive = await prisma.chat.findMany({
        where: { updatedAt: { gte: getDateRange(60), lt: getDateRange(30) } },
        select: { userId: true },
        distinct: ["userId"],
    });
    const recentlyActive = await prisma.chat.findMany({
        where: { updatedAt: { gte: getDateRange(30) } },
        select: { userId: true },
        distinct: ["userId"],
    });
    const recentIds = new Set(recentlyActive.map((c) => c.userId));
    const churned = previouslyActive.filter((c) => !recentIds.has(c.userId)).length;

    // ── Cohort analysis ──
    console.log("    Computing cohort retention...");
    const allUsers = await prisma.user.findMany({
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });

    const activityRows: Array<{ userId: string; activeMonth: string }> = await prisma.$queryRaw`
        SELECT DISTINCT c.userId, DATE_FORMAT(m.createdAt, '%Y-%m') AS activeMonth
        FROM Message m
        JOIN Chat c ON m.chatId = c.id
        WHERE m.role = 'user'
    `;

    const activityMap = new Map<string, Set<string>>();
    for (const row of activityRows) {
        if (!activityMap.has(row.userId)) activityMap.set(row.userId, new Set());
        activityMap.get(row.userId)!.add(row.activeMonth);
    }

    const cohortMap = new Map<string, string[]>();
    for (const user of allUsers) {
        const cohortMonth = formatYearMonth(user.createdAt);
        if (!cohortMap.has(cohortMonth)) cohortMap.set(cohortMonth, []);
        cohortMap.get(cohortMonth)!.push(user.id);
    }

    const currentYearMonth = formatYearMonth(now);
    const cohorts = Array.from(cohortMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cohortMonth, userIds]) => {
            const [cy, cm] = cohortMonth.split("-").map(Number);
            const retention: Array<{ monthOffset: number; activeUsers: number; retentionRate: number }> = [];
            let offset = 0;
            let yearMonth = cohortMonth;

            while (yearMonth <= currentYearMonth) {
                const activeCount = userIds.filter((uid) => activityMap.get(uid)?.has(yearMonth)).length;
                retention.push({
                    monthOffset: offset,
                    activeUsers: activeCount,
                    retentionRate: pct(activeCount, userIds.length),
                });
                offset++;
                const totalMonths = (cy - 1) * 12 + cm - 1 + offset;
                const nextYear = Math.floor(totalMonths / 12) + 1;
                const nextMonth = (totalMonths % 12) + 1;
                yearMonth = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
            }

            return { cohortMonth, cohortSize: userIds.length, retention };
        });

    return {
        dayNRetention: {
            day1,
            day7,
            day30,
        },
        monthlyChurn: {
            previouslyActiveUsers: previouslyActive.length,
            churnedUsers: churned,
            retainedUsers: previouslyActive.length - churned,
            churnRate: pct(churned, previouslyActive.length),
            retentionRate: pct(previouslyActive.length - churned, previouslyActive.length),
        },
        cohortRetention: {
            description: "Monthly signup cohorts — how many users returned in subsequent months",
            cohorts,
        },
    };
}

async function collectContentMetrics() {
    console.log("  → Content & feature metrics...");

    const totalUsers = await prisma.user.count();

    // ── Contract Sessions ──
    const [
        totalContracts,
        contractsByType,
        contractsByLanguage,
        contractsByStatus,
    ] = await Promise.all([
        prisma.contractSession.count(),
        prisma.contractSession.groupBy({ by: ["contractType"], _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
        prisma.contractSession.groupBy({ by: ["language"], _count: { id: true } }),
        prisma.contractSession.groupBy({ by: ["status"], _count: { id: true } }),
    ]);

    const monthlyContracts: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM ContractSession GROUP BY month ORDER BY month ASC
    `;

    // ── Generated Documents ──
    const [totalDocs, docsByType] = await Promise.all([
        prisma.generatedDocument.count(),
        prisma.generatedDocument.groupBy({ by: ["type"], _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
    ]);

    const monthlyDocs: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM GeneratedDocument GROUP BY month ORDER BY month ASC
    `;

    // ── File Uploads ──
    const [totalFiles, filesByMimetype, fileSizeAgg] = await Promise.all([
        prisma.userFile.count(),
        prisma.userFile.groupBy({ by: ["mimetype"], _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
        prisma.userFile.aggregate({ _sum: { size: true }, _avg: { size: true }, _max: { size: true } }),
    ]);

    const monthlyFiles: Array<{ month: string; count: bigint }> = await prisma.$queryRaw`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, COUNT(*) AS count
        FROM UserFile GROUP BY month ORDER BY month ASC
    `;

    // ── Feedback ──
    const [totalLikes, totalDislikes, totalFeedback] = await Promise.all([
        prisma.message.count({ where: { feedback: "like" } }),
        prisma.message.count({ where: { feedback: "dislike" } }),
        prisma.message.count({ where: { feedback: { not: null } } }),
    ]);

    const totalMessages = await prisma.message.count();

    const monthlyFeedback: Array<{ month: string; likes: bigint; dislikes: bigint }> = await prisma.$queryRaw`
        SELECT
            DATE_FORMAT(createdAt, '%Y-%m') AS month,
            SUM(CASE WHEN feedback = 'like' THEN 1 ELSE 0 END) AS likes,
            SUM(CASE WHEN feedback = 'dislike' THEN 1 ELSE 0 END) AS dislikes
        FROM Message
        WHERE feedback IS NOT NULL
        GROUP BY month ORDER BY month ASC
    `;

    // ── Feature Adoption (unique users per feature) ──
    const [chatUsers, contractUsers, fileUsers, docUsers] = await Promise.all([
        prisma.chat.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.contractSession.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.userFile.findMany({ select: { userId: true }, distinct: ["userId"] }),
        prisma.generatedDocument.findMany({ select: { userId: true }, distinct: ["userId"] }),
    ]);

    // ── Contract messages ──
    const totalContractMessages = await prisma.contractMessage.count();
    const avgContractMsgsPerSession = totalContracts > 0
        ? round(totalContractMessages / totalContracts)
        : 0;

    return {
        contracts: {
            total: totalContracts,
            uniqueUsers: contractUsers.length,
            totalMessages: totalContractMessages,
            avgMessagesPerSession: avgContractMsgsPerSession,
            byType: contractsByType.map((r) => ({
                type: r.contractType,
                count: r._count.id,
                percentage: pct(r._count.id, totalContracts),
            })),
            byLanguage: contractsByLanguage.map((r) => ({
                language: r.language,
                count: r._count.id,
                percentage: pct(r._count.id, totalContracts),
            })),
            byStatus: contractsByStatus.map((r) => ({
                status: r.status,
                count: r._count.id,
                percentage: pct(r._count.id, totalContracts),
            })),
            monthlyTrend: monthlyContracts.map((r) => ({
                month: r.month,
                sessions: Number(r.count),
            })),
        },
        documents: {
            total: totalDocs,
            uniqueUsers: docUsers.length,
            byType: docsByType.map((r) => ({
                type: r.type,
                count: r._count.id,
                percentage: pct(r._count.id, totalDocs),
            })),
            monthlyTrend: monthlyDocs.map((r) => ({
                month: r.month,
                documents: Number(r.count),
            })),
        },
        files: {
            total: totalFiles,
            uniqueUsers: fileUsers.length,
            totalSizeBytes: fileSizeAgg._sum.size ?? 0,
            totalSizeMB: round((fileSizeAgg._sum.size ?? 0) / 1024 / 1024),
            avgFileSizeBytes: Math.round(fileSizeAgg._avg.size ?? 0),
            maxFileSizeBytes: fileSizeAgg._max.size ?? 0,
            byMimetype: filesByMimetype.map((r) => ({
                mimetype: r.mimetype,
                count: r._count.id,
                percentage: pct(r._count.id, totalFiles),
            })),
            monthlyTrend: monthlyFiles.map((r) => ({
                month: r.month,
                uploads: Number(r.count),
            })),
        },
        feedback: {
            totalResponses: totalFeedback,
            totalLikes,
            totalDislikes,
            feedbackRate: pct(totalFeedback, totalMessages),
            satisfactionRate: pct(totalLikes, totalFeedback),
            likeToDislikeRatio: totalDislikes > 0 ? round(totalLikes / totalDislikes) : null,
            monthlyTrend: monthlyFeedback.map((r) => ({
                month: r.month,
                likes: Number(r.likes),
                dislikes: Number(r.dislikes),
                satisfactionRate: pct(Number(r.likes), Number(r.likes) + Number(r.dislikes)),
            })),
        },
        featureAdoption: {
            description: "Percentage of total users who have ever used each feature",
            totalUsers,
            features: [
                {
                    feature: "AI Chat / Legal Q&A",
                    uniqueUsers: chatUsers.length,
                    adoptionRate: pct(chatUsers.length, totalUsers),
                },
                {
                    feature: "Contract Builder",
                    uniqueUsers: contractUsers.length,
                    adoptionRate: pct(contractUsers.length, totalUsers),
                },
                {
                    feature: "File Uploads",
                    uniqueUsers: fileUsers.length,
                    adoptionRate: pct(fileUsers.length, totalUsers),
                },
                {
                    feature: "Document Generation",
                    uniqueUsers: docUsers.length,
                    adoptionRate: pct(docUsers.length, totalUsers),
                },
            ],
        },
    };
}

async function collectPlatformHealth() {
    console.log("  → Platform health...");
    const now = new Date();

    // Database row counts
    const [users, chats, messages, files, documents, contractSessions, contractMessages] = await Promise.all([
        prisma.user.count(),
        prisma.chat.count(),
        prisma.message.count(),
        prisma.userFile.count(),
        prisma.generatedDocument.count(),
        prisma.contractSession.count(),
        prisma.contractMessage.count(),
    ]);

    // Message versioning stats
    const [activeMessages, inactiveMessages, versionedMessages] = await Promise.all([
        prisma.message.count({ where: { isActive: true } }),
        prisma.message.count({ where: { isActive: false } }),
        prisma.message.count({ where: { version: { gt: 1 } } }),
    ]);

    // Recency: how many records created in last 7/30 days
    const [users7d, chats7d, messages7d, users30d, chats30d, messages30d] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: getDateRange(7) } } }),
        prisma.chat.count({ where: { createdAt: { gte: getDateRange(7) } } }),
        prisma.message.count({ where: { createdAt: { gte: getDateRange(7) }, role: "user" } }),
        prisma.user.count({ where: { createdAt: { gte: getDateRange(30) } } }),
        prisma.chat.count({ where: { createdAt: { gte: getDateRange(30) } } }),
        prisma.message.count({ where: { createdAt: { gte: getDateRange(30) }, role: "user" } }),
    ]);

    // Users who never sent a message
    const usersWithChats = await prisma.chat.findMany({ select: { userId: true }, distinct: ["userId"] });
    const inactiveUsers = users - usersWithChats.length;

    return {
        databaseSize: {
            users,
            conversations: chats,
            messages,
            fileUploads: files,
            generatedDocuments: documents,
            contractSessions,
            contractMessages,
            totalRecords: users + chats + messages + files + documents + contractSessions + contractMessages,
        },
        messageIntegrity: {
            activeMessages,
            inactiveMessages,
            versionedMessages,
            regenerationRate: pct(versionedMessages, messages),
        },
        recentActivity: {
            last7Days: {
                newUsers: users7d,
                newConversations: chats7d,
                userMessages: messages7d,
            },
            last30Days: {
                newUsers: users30d,
                newConversations: chats30d,
                userMessages: messages30d,
            },
        },
        userActivity: {
            usersWithAtLeastOneConversation: usersWithChats.length,
            inactiveUsers,
            inactiveRate: pct(inactiveUsers, users),
        },
        exportedAt: now.toISOString(),
        exportedAtLocal: now.toLocaleString(),
    };
}

// ─── Report Generator ─────────────────────────────────────────────────────────

function generateMarkdownReport(data: Record<string, unknown>): string {
    const d = data as {
        exportedAt: string;
        platformHealth: {
            databaseSize: Record<string, number>;
            recentActivity: { last7Days: Record<string, number>; last30Days: Record<string, number> };
            userActivity: { inactiveRate: number; inactiveUsers: number; usersWithAtLeastOneConversation: number };
        };
        userMetrics: {
            totals: { total: number; onboarded: number; onboardingRate: number };
            growthByPeriod: Record<string, { newUsers: number; growthRate: number }>;
            marketingSources: Array<{ source: string; count: number; percentage: number }>;
        };
        engagementMetrics: {
            totals: Record<string, number>;
            activeUsers: { dau: number; wau: number; mau: number };
            perUserStats: Record<string, number>;
            engagementDepthDistribution: Array<{ bucket: string; userCount: number; percentage: number }>;
        };
        retentionMetrics: {
            dayNRetention: { day1: { rate: number }; day7: { rate: number }; day30: { rate: number } };
            monthlyChurn: { churnRate: number };
        };
        contentMetrics: {
            feedback: { satisfactionRate: number; totalLikes: number; totalDislikes: number; feedbackRate: number };
            featureAdoption: { features: Array<{ feature: string; adoptionRate: number }> };
            contracts: { total: number; byType: Array<{ type: string; count: number }> };
            documents: { total: number };
            files: { total: number; totalSizeMB: number };
        };
    };

    const lines: string[] = [];
    const exportDate = new Date(d.exportedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    lines.push(`# 9anon Platform Analytics Report`);
    lines.push(`**Generated:** ${exportDate}  `);
    lines.push(`**Data coverage:** All time (full database)  `);
    lines.push(`**Privacy:** No personal data — all numbers only\n`);

    lines.push(`---\n`);

    lines.push(`## 1. Platform Overview\n`);
    const db = d.platformHealth.databaseSize;
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Users | ${db.users.toLocaleString()} |`);
    lines.push(`| Total Conversations | ${db.conversations.toLocaleString()} |`);
    lines.push(`| Total Messages | ${db.messages.toLocaleString()} |`);
    lines.push(`| Contract Sessions | ${db.contractSessions.toLocaleString()} |`);
    lines.push(`| Documents Generated | ${db.generatedDocuments.toLocaleString()} |`);
    lines.push(`| File Uploads | ${db.fileUploads.toLocaleString()} |`);
    lines.push(`| Onboarding Rate | ${d.userMetrics.totals.onboardingRate}% |`);
    lines.push(`| Inactive Users (never chatted) | ${d.platformHealth.userActivity.inactiveRate}% |`);
    lines.push(``);

    lines.push(`## 2. User Growth\n`);
    const g = d.userMetrics.growthByPeriod;
    lines.push(`| Period | New Users | Growth Rate |`);
    lines.push(`|--------|-----------|-------------|`);
    lines.push(`| Last 7 Days | ${g.last7Days.newUsers} | ${g.last7Days.growthRate > 0 ? "+" : ""}${g.last7Days.growthRate}% |`);
    lines.push(`| Last 30 Days | ${g.last30Days.newUsers} | ${g.last30Days.growthRate > 0 ? "+" : ""}${g.last30Days.growthRate}% |`);
    lines.push(`| Last 90 Days | ${g.last90Days.newUsers} | ${g.last90Days.growthRate > 0 ? "+" : ""}${g.last90Days.growthRate}% |`);
    lines.push(`| Last 12 Months | ${g.last12Months.newUsers} | ${g.last12Months.growthRate > 0 ? "+" : ""}${g.last12Months.growthRate}% |`);
    lines.push(``);

    lines.push(`**Top Traffic Sources:**\n`);
    for (const s of d.userMetrics.marketingSources.slice(0, 5)) {
        lines.push(`- ${s.source}: ${s.count} users (${s.percentage}%)`);
    }
    lines.push(``);

    lines.push(`## 3. Engagement\n`);
    const eng = d.engagementMetrics;
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| DAU (today) | ${eng.activeUsers.dau} |`);
    lines.push(`| WAU (7d) | ${eng.activeUsers.wau} |`);
    lines.push(`| MAU (30d) | ${eng.activeUsers.mau} |`);
    lines.push(`| Avg Messages / User | ${eng.perUserStats.avgMessagesPerUser} |`);
    lines.push(`| Median Messages / User | ${eng.perUserStats.medianMessagesPerUser} |`);
    lines.push(`| Avg Conversations / User | ${eng.perUserStats.avgConversationsPerUser} |`);
    lines.push(`| Avg Messages / Conversation | ${eng.perUserStats.avgMessagesPerConversation} |`);
    lines.push(``);

    lines.push(`**Engagement depth distribution:**\n`);
    for (const b of eng.engagementDepthDistribution) {
        const bar = "█".repeat(Math.round(b.percentage / 5));
        lines.push(`- ${b.bucket.padEnd(20)} ${bar} ${b.userCount} users (${b.percentage}%)`);
    }
    lines.push(``);

    lines.push(`## 4. Retention\n`);
    const ret = d.retentionMetrics;
    lines.push(`| Retention Window | Rate | Benchmark |`);
    lines.push(`|------------------|------|-----------|`);
    lines.push(`| Day-1 Retention | ${ret.dayNRetention.day1.rate}% | Industry avg: 25–40% |`);
    lines.push(`| Day-7 Retention | ${ret.dayNRetention.day7.rate}% | Industry avg: 10–25% |`);
    lines.push(`| Day-30 Retention | ${ret.dayNRetention.day30.rate}% | Industry avg: 5–15% |`);
    lines.push(`| Monthly Churn | ${ret.monthlyChurn.churnRate}% | Lower is better |`);
    lines.push(``);

    lines.push(`## 5. Content & Features\n`);
    const cnt = d.contentMetrics;
    lines.push(`**Feature Adoption (% of all users):**\n`);
    for (const f of cnt.featureAdoption.features) {
        const bar = "█".repeat(Math.round(f.adoptionRate / 5));
        lines.push(`- ${f.feature.padEnd(25)} ${bar} ${f.adoptionRate}%`);
    }
    lines.push(``);

    lines.push(`**User Feedback:**\n`);
    lines.push(`- Feedback participation rate: ${cnt.feedback.feedbackRate}% of messages`);
    lines.push(`- Satisfaction rate: ${cnt.feedback.satisfactionRate}%`);
    lines.push(`- Total likes: ${cnt.feedback.totalLikes.toLocaleString()}`);
    lines.push(`- Total dislikes: ${cnt.feedback.totalDislikes.toLocaleString()}`);
    lines.push(``);

    lines.push(`**Contracts by type:**\n`);
    for (const t of cnt.contracts.byType) {
        lines.push(`- ${t.type}: ${t.count} (${pct(t.count, cnt.contracts.total)}%)`);
    }
    lines.push(``);

    lines.push(`---`);
    lines.push(`*This report was auto-generated by \`export-analytics.ts\`. Data is aggregated and anonymized.*`);

    return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n🔍 9anon Analytics Exporter");
    console.log("═══════════════════════════════════════");
    console.log("Collecting data from database...\n");

    try {
        await prisma.$connect();

        // Collect all sections in parallel where possible
        const [userMetrics, engagementMetrics, contentMetrics, platformHealth] = await Promise.all([
            collectUserMetrics(),
            collectEngagementMetrics(),
            collectContentMetrics(),
            collectPlatformHealth(),
        ]);

        // Retention is sequential due to per-user loop (can be slow on large datasets)
        const retentionMetrics = await collectRetentionMetrics();

        const exportData = {
            meta: {
                generatedAt: new Date().toISOString(),
                platform: "9anon Legal AI",
                dataNote: "All numerical data only. No personal data (emails, names, message content, user IDs) is included.",
                sections: ["platformHealth", "userMetrics", "engagementMetrics", "retentionMetrics", "contentMetrics"],
            },
            exportedAt: new Date().toISOString(),
            platformHealth,
            userMetrics,
            engagementMetrics,
            retentionMetrics,
            contentMetrics,
        };

        // ── Write JSON ──
        const dateStr = formatDate(new Date());
        const jsonFilename = `analytics-export-${dateStr}.json`;
        const jsonPath = path.join(process.cwd(), jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2), "utf-8");

        // ── Write Markdown Report ──
        const mdFilename = `analytics-report-${dateStr}.md`;
        const mdPath = path.join(process.cwd(), mdFilename);
        const report = generateMarkdownReport(exportData);
        fs.writeFileSync(mdPath, report, "utf-8");

        // ── Print summary ──
        console.log("\n✅ Export complete!\n");
        console.log("═══════════════════════════════════════");
        console.log(`📊 JSON data file:   ${jsonFilename}`);
        console.log(`   Size:             ${(fs.statSync(jsonPath).size / 1024).toFixed(1)} KB`);
        console.log(`📄 Markdown report:  ${mdFilename}`);
        console.log(`   Size:             ${(fs.statSync(mdPath).size / 1024).toFixed(1)} KB`);
        console.log("═══════════════════════════════════════\n");

        console.log("📈 Quick snapshot:");
        console.log(`   Users:            ${platformHealth.databaseSize.users.toLocaleString()}`);
        console.log(`   Conversations:    ${platformHealth.databaseSize.conversations.toLocaleString()}`);
        console.log(`   Messages:         ${platformHealth.databaseSize.messages.toLocaleString()}`);
        console.log(`   DAU / WAU / MAU:  ${engagementMetrics.activeUsers.dau} / ${engagementMetrics.activeUsers.wau} / ${engagementMetrics.activeUsers.mau}`);
        console.log(`   Day-30 Retention: ${retentionMetrics.dayNRetention.day30.rate}%`);
        console.log(`   Satisfaction:     ${contentMetrics.feedback.satisfactionRate}%`);
        console.log("\n💡 Feed the JSON file to any AI assistant for deep analysis.");
        console.log("   The Markdown report is a ready-to-share human summary.\n");

    } catch (err) {
        console.error("\n❌ Export failed:", err);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
