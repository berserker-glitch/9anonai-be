// Script to create a superadmin user
// Run with: npx ts-node scripts/create-superadmin.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function createSuperAdmin() {
    const email = "admin@9anonai.com";
    const password = "9anon9anonAIAI"; // Change this to a secure password!
    const name = "Super Admin";

    try {
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            // Update existing user to superadmin
            const updated = await prisma.user.update({
                where: { email },
                data: { role: "superadmin" }
            });
            console.log(`✅ Updated existing user to superadmin: ${updated.email}`);
            return;
        }

        // Create new superadmin user
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: "superadmin"
            }
        });

        console.log(`✅ Superadmin user created successfully!`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Password: ${password}`);
        console.log(`   Role: ${user.role}`);
    } catch (error) {
        console.error("❌ Error creating superadmin:", error);
    } finally {
        await prisma.$disconnect();
    }
}

createSuperAdmin();
