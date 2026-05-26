import fs from 'fs';

const TOKEN = process.env.GITHUB_TOKEN || "";
const OWNER = "yosemite01";
const REPO = "stellar-creator-portfolio";

const createMarkdown = (desc, files, actions) => `### Description\n${desc}\n\n### Files Involved\n${files.map(f => `- \`${f}\``).join('\n')}\n\n### Action Items\n${actions.map(a => `- [ ] ${a}`).join('\n')}`;

const rawIssues = [
    // BACKEND
    {
        title: "[Backend] Setup GraphQL or tRPC infrastructure for typed queries",
        labels: ["backend", "enhancement"],
        body: createMarkdown(
            "The application currently lacks deeply nested typed queries causing overfetching. Implementing tRPC or GraphQL will optimize network usage and provide typed validations connecting the backend efficiently.",
            ["backend/src/router.ts", "package.json", "backend/src/trpc-setup.ts"],
            ["Initialize tRPC or GraphQL endpoints.", "Map Prisma schemas to return types directly.", "Secure the endpoint with NextAuth/JWT context.", "Write integration tests for the router."]
        )
    },
    {
        title: "[Backend] Implement cursor-based pagination and filtering for Registry endpoints",
        labels: ["backend", "performance"],
        body: createMarkdown(
            "As volume scales, fetching unpaginated items harms performance. Implement cursor-based pagination utilizing Prisma.",
            ["backend/services/bounty.service.ts", "backend/limit/endpoints.ts"],
            ["Implement `take` and `cursor` properties for the items query.", "Support dynamic filtering (status, budget size).", "Calculate hasNextPage optimization on response payload."]
        )
    },
    {
        title: "[Backend] Setup comprehensive audit logging & telemetry for mutations",
        labels: ["backend", "security"],
        body: createMarkdown(
            "We need a strong audit trail recording precisely who created what and when to prevent misuse and secure traceability.",
            ["backend/services/audit.ts", "prisma/schema.prisma"],
            ["Add `AuditLog` table securely mapped to users.", "Implement interceptor to inject telemetry traces.", "Log IP or meta headers silently alongside the mutation."]
        )
    },
    {
        title: "[Backend] Introduce endpoint Rate Limiting structures",
        labels: ["backend", "security"],
        body: createMarkdown(
            "Unprotected API endpoints are liable to scraping. Apply rate limiting via Redis or memory structures depending on deployment topology.",
            ["backend/src/rateLimit.ts", "backend/src/middleware.ts"],
            ["Install and configure rate limiting library.", "Apply limits to unauthenticated endpoint structures.", "Apply customized higher-tier limits to authenticated profile actions."]
        )
    },
    {
        title: "[Backend] Implement backend Event Emitter / Subscription webhook infrastructure",
        labels: ["backend", "architecture"],
        body: createMarkdown(
            "We need domain events to trigger emails internally without blocking the main event loops. This necessitates an event system architecture.",
            ["backend/services/events.ts", "backend/src/listeners.ts"],
            ["Establish a pub-sub domain event bus.", "Refactor hard-coupled logic to dispatch domain events (e.g. `BountyCreated` event).", "Ensure listeners robustly catch these events."]
        )
    },
    // FRONTEND (Heavy Improvements)
    {
        title: "[Frontend] Introduce Dynamic Link Verifications for Profiles (GitHub, Figma)",
        labels: ["frontend", "feature", "heavy"],
        body: createMarkdown(
            "Designers and developers require heavy frontend UX to link their github, figma, and portfolios. This includes custom parsing, validation, and specialized widget visualizations of their external profiles.",
            ["app/profile/edit/page.tsx", "components/forms/profile-form.tsx", "components/ui/social-links.tsx"],
            ["Build the visual portfolio aggregation widget components for Profiles.", "Fetch real-time data from GitHub API if linked utilizing server-side components.", "Style heavily with custom Framer Motion hover animations."]
        )
    },
    {
        title: "[Frontend] Develop Rich-Text block editor for Project details",
        labels: ["frontend", "feature"],
        body: createMarkdown(
            "Standard textareas are insufficient for project specifics. Integrate a Blocknote or TipTap rich-text editor enabling creators to show markdown-equivalent features visually.",
            ["components/ui/rich-text.tsx", "components/forms/project-create.tsx"],
            ["Integrate TipTap block editor library seamlessly.", "Establish custom extensions for embedding Youtube/Loom.", "Persist sanitized HTML to the Prisma backend."]
        )
    },
    {
        title: "[Frontend] Architect Application Suspense Boundaries and Streaming UI",
        labels: ["frontend", "performance", "heavy"],
        body: createMarkdown(
            "Heavy assets loading independently should not block user workflows. We must employ React 18 Suspense with Next.js Streaming architectures.",
            ["app/creators/[id]/page.tsx", "app/bounties/page.tsx", "components/ui/skeleton-group.tsx"],
            ["Map out asynchronous fetching requests natively mapped directly to components.", "Wrap extensive heavy operations in `<Suspense>` bounds.", "Implement elegant Skeleton variants preserving UI layouts."]
        )
    },
    {
        title: "[Frontend] Refactor Layout framework ensuring holistic Responsive Design",
        labels: ["frontend", "UI/UX"],
        body: createMarkdown(
            "The application needs to adapt flawlessly from Ultra-wide displays down to narrow portrait mobile browser dimensions, employing advanced CSS Grid.",
            ["app/layout.tsx", "styles/globals.css", "components/sidebar.tsx"],
            ["Audit standard breakpoints targeting tablet and mobile sizing.", "Convert manual pixel positioning into robust Tailwind flexible layouts.", "Implement sliding off-canvas menu structurally for mobile views."]
        )
    },
    {
        title: "[Frontend] Add profound Framer Motion Page Transition & Micro-interactions",
        labels: ["frontend", "UI/UX", "heavy"],
        body: createMarkdown(
            "To stand out natively, the site needs liquid transitions between navigational shifts and high-fidelity micro-interactions upon elements.",
            ["app/template.tsx", "components/ui/button.tsx", "components/ui/card.tsx"],
            ["Configure `framer-motion` for AnimatePresence page changes.", "Inject spring-based scaling reactions on buttons and clickable UI cards.", "Ensure animations respect `prefers-reduced-motion` settings."]
        )
    },
    // SMART CONTRACT
    {
        title: "[Contract] Build Decentralized Authenticity Contract for Social Links",
        labels: ["contract", "feature"],
        body: createMarkdown(
            "To distinguish standard Web2 fields from Web3 capabilities, users should be able to submit cryptographic proofs on-chain verifying profile links natively.",
            ["contracts/identity/src/lib.rs", "contracts/identity/src/test.rs"],
            ["Implement a Soroban schema mapping addresses to domain hashes.", "Verify signature authenticity natively within the transaction envelope.", "Draft explicit unit tests matching error boundaries."]
        )
    },
    {
        title: "[Contract] Implement the basis points limitation guards for platform fees",
        labels: ["contract", "security"],
        body: createMarkdown(
            "A safety constraint must limit platform fees to a theoretical maximum (e.g. 10000 basis points equals 100%). Any changes attempting to exceed should panic.",
            ["contracts/core/src/fee.rs", "contracts/core/src/lib.rs"],
            ["Define logical panic thresholds for fee alterations.", "Write explicit `test_fee_limit_rejection` tests to prove functionality.", "Apply it centrally around any value retention workflows."]
        )
    },
    {
        title: "[Contract] Configure Contract Simulation pre-flight endpoints",
        labels: ["contract", "performance"],
        body: createMarkdown(
            "Prior to submitting real transactions globally, implement RPC simulated endpoint connections checking functionality proactively.",
            ["services/soroban-indexer.ts", "contracts/core/src/simulate.rs"],
            ["Map out RPC network connections ensuring proper parameters.", "Ensure accurate Gas computation logs are parsed effectively.", "Return failures gracefully before prompting the user's wallet confirmation."]
        )
    },
    {
        title: "[Contract] Add cross-contract comprehensive TTL Legacy refreshment",
        labels: ["contract", "maintenance"],
        body: createMarkdown(
            "Soroban features expiring contract storage if not periodically refreshed. Architecture must guarantee our storage components don't degrade.",
            ["contracts/core/src/storage.rs"],
            ["Implement `env.storage().persistent().extend_ttl()` correctly across functions.", "Monitor and bump states on read and write workflows seamlessly.", "Validate TTL behavior securely inside unit test frames."]
        )
    },
    {
        title: "[Contract] Enfranchise Multi-Vault withdrawal mechanisms securely",
        labels: ["contract", "enhancement"],
        body: createMarkdown(
            "Enable batch processing optimizations avoiding iterative single-transactions which congest network load.",
            ["contracts/vault/src/lib.rs", "contracts/vault/src/batch.rs"],
            ["Establish vectorized processing loops verifying token allocations securely.", "Enforce atomic failure ensuring singular batch failures don't ruin execution states.", "Document gas optimization levels heavily."]
        )
    },
    // TESTNET TO MAINNET
    {
        title: "[Network] Enable robust Mainnet vs Testnet logic toggling abstractions",
        labels: ["network", "infrastructure"],
        body: createMarkdown(
            "Application must flip seamlessly between Mainnet for real usage and Testnet for staging without manual code rewriting.",
            ["lib/config/network.ts", ".env.example"],
            ["Decouple hardcoded Soroban RPC URIs natively.", "Drive all network configurations by explicitly typed environment variables.", "Provide visual cues if the network is set to Testnet within UX."]
        )
    },
    {
        title: "[Network] Harden infrastructure Key Management implementations",
        labels: ["network", "security"],
        body: createMarkdown(
            "Migrating to Mainnet requires production-safe key management configurations for administrator overrides.",
            ["backend/services/kms.ts", "infrastructure/aws/kms.yaml"],
            ["Adopt AWS KMS or Azure Vault integrations rather than flat DOTENV secrets.", "Rotate and provision deployer secret keys efficiently.", "Perform a holistic audit guaranteeing logic doesn't leak secrets via error outputs."]
        )
    },
    {
        title: "[Network] Establish Reproducible Builds for Mainnet contracts",
        labels: ["network", "infrastructure"],
        body: createMarkdown(
            "Mainnet code should be perfectly auditable. Contracts compiled must feature matching hashes relative to their source structures.",
            ["scripts/build-reproducible.sh", "scripts/verify.sh", "Dockerfile"],
            ["Lock rust compliers and dependencies via explicit definitions natively.", "Use soroban-cli docker methodologies ensuring output binaries remain identical.", "Validate hashes routinely within CI workflows."]
        )
    },
    {
        title: "[Network] Enable CI/CD pipeline deployments explicitly for Mainnet configurations",
        labels: ["network", "devops"],
        body: createMarkdown(
            "Set up GitHub Actions to manage and route deployments appropriately applying rigorous Mainnet guards natively.",
            [".github/workflows/deploy-mainnet.yml", "scripts/deploy.js"],
            ["Deploy explicitly upon release structures not mere merge cycles.", "Validate contracts successfully simulate against Mainnet RPCs pre-submit.", "Draft notification steps broadcasting new addresses heavily."]
        )
    },
    {
        title: "[Network] Setup High Availability Fallback RPC infrastructure",
        labels: ["network", "infrastructure"],
        body: createMarkdown(
            "Single RPC points of failure degrade user capabilities drastically on Mainnet loads. Implement load balancing arrays.",
            ["lib/config/rpc-fallback.ts"],
            ["Map out primary and secondary alternative URL endpoints.", "Wrap transaction fetch systems ensuring automatic retry/switch logic.", "Monitor node latency ensuring healthy rotation algorithms."]
        )
    },
    // MOBILE (40 issues)
    ...Array.from({ length: 40 }).map((_, i) => {
        const titles = [
            "Setup Expo Router configuration and initial layout structuring",
            "Initialize Mobile State Management with Zustand",
            "Create Native Authenticated Global Header component",
            "Define standard native precise Typography styles matching current design system",
            "Build dynamic Primary and Secondary Native Buttons conforming to Touch Targets",
            "Draft standard Mobile Form Inputs and Accessibility implementations",
            "Develop independent Native Profile Avatar and Status Badges",
            "Implement the `auth/login` gateway utilizing WalletConnect deep links natively",
            "Implement the `auth/register` introductory flow screens natively",
            "Provide Native Biometric Authentication methodologies (FaceID/TouchID)",
            "Develop the primary native Home Screen aggregating trending portfolios",
            "Develop the native Project & Bounty generalized list layout",
            "Integrate standard Pull-To-Refresh configurations on network collections",
            "Implement specialized Infinite Scrolling structures preserving memory gracefully",
            "Develop explicit screen providing dedicated Native Details View implementations",
            "Build native interactive Proposal/Application modal systems securely",
            "Construct explicit dynamic Creator Native Profile visualizations correctly",
            "Configure standard Deep-Linking logic enabling URL interceptions globally",
            "Establish the specific standard Freelancer directory browsing experience",
            "Integrate device specific Image Picker logic natively optimizing heavy imagery",
            "Provide mobile capable File Upload logic directly communicating externally to Buckets",
            "Construct explicit comprehensive Preferences mapping natively",
            "Integrate explicit standard Expo Push Notification workflows securely",
            "Provide caching capabilities enabling rapid revisit metrics via Async Storage natively",
            "Design heavily offline-capable degraded application logic protecting user operations natively",
            "Enable explicit native system level Share capabilities communicating to generic endpoints globally",
            "Construct explicit comprehensive global Activity timeline summaries internally",
            "Support dynamic native explicit Internationalization paradigms systematically",
            "Establish native explicit operating system matched Dark mode logic centrally",
            "Finalize explicit liquid layout Native Stack transition behaviors internally",
            "Develop exact distinct native specific Dashboard analytics mappings accurately",
            "Construct explicit highly robust native specific User rating structures internally",
            "Develop specific distinct interactive Direct Messaging layout architectures",
            "Integrate specific fluid interactive standard Websocket capabilities comprehensively",
            "Manage comprehensive exact localized Keyboard avoidance behavioral anomalies precisely",
            "Integrate explicit distinct standard layout Toast notifications accurately globally",
            "Leverage specific generalized standard localized Mobile form validations identically securely",
            "Design standard distinct comprehensive interactive new user Application walkthroughs visually",
            "Construct specific distinct exact crash tracking Sentry specific metrics thoroughly",
            "Provide specific distinct exact production release distribution specific mappings definitively"
        ];
        return {
            title: `[Mobile] ${titles[i]}`,
            labels: ["mobile", "feature"],
            body: createMarkdown(
                `This issue specifically addresses building and establishing the native mobile functionality surrounding "${titles[i]}" comprehensively inside the Expo application natively providing excellent capabilities relative strictly to user expectations explicitly.`,
                [`mobile/src/components/`, `mobile/src/screens/`, `mobile/app.json`],
                [
                    "Establish robust standard specific UI layouts successfully explicitly.",
                    "Verify capability logic mappings distinctively.",
                    "Optimize rendering natively eliminating generic frame drops explicitly."
                ]
            )
        };
    })
];

async function run() {
    console.log(`Starting to push ${rawIssues.length} issues...`);
    for (let i = 0; i < rawIssues.length; i++) {
        const issue = rawIssues[i];

        // We space out requests to avoid Github API secondary rate limits securely
        await new Promise(r => setTimeout(r, 600));

        try {
            const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues`, {
                method: "POST",
                headers: {
                    "Authorization": `token ${TOKEN}`,
                    "Accept": "application/vnd.github.v3+json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    title: issue.title,
                    body: issue.body,
                    labels: issue.labels
                })
            });

            if (!response.ok) {
                const err = await response.json();
                console.error(`Failed pushing issue ${i + 1}:`, err);
            } else {
                console.log(`Successfully pushed issue ${i + 1}: ${issue.title}`);
            }
        } catch (e) {
            console.error(`Exception on issue ${i + 1}`, e);
        }
    }
    console.log("Finished pushing 60 issues.");
}

run();
