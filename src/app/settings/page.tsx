import { getAppUsers, getConsultantUtilizationDirectory } from "@/app/actions";
import { UserAccessSettings } from "@/components/UserAccessSettings";
import { getAppSession, isAuthEnabled, requireAdminSession } from "@/lib/auth";
import Link from "next/link";

export default async function SettingsPage() {
    if (isAuthEnabled) {
        await requireAdminSession();
    }

    const consultantRoster = await getConsultantUtilizationDirectory();

    const [users, session] = await Promise.all([
        getAppUsers(consultantRoster),
        getAppSession(),
    ]);
    const consultantEmails = new Set(
        consultantRoster
            .map((consultant) => String(consultant.email || "").trim().toLowerCase())
            .filter((email) => email.length > 0)
    );
    const filteredUsers = users.filter((user) => {
        const emailKey = String(user.email || "").trim().toLowerCase();
        if (String(user.status || "").toLowerCase() === "disabled") return false;
        return consultantEmails.has(emailKey);
    });

    const currentUserName = String(session?.user?.name || "Mission Control Admin").trim() || "Mission Control Admin";

    return (
        <main className="h-screen overflow-y-auto bg-background px-6 py-8 text-text-main">
            <div className="mx-auto mb-4 flex w-full max-w-6xl">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white hover:bg-white/[0.08]"
                >
                    Back To Main Menu
                </Link>
            </div>
            <UserAccessSettings
                initialUsers={filteredUsers}
                consultantDirectory={consultantRoster}
                currentUserName={currentUserName}
                authEnabled={isAuthEnabled}
            />
        </main>
    );
}
