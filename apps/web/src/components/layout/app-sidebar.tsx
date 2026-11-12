import type { HeraldEnv } from "@herald/core";
import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import {
  BanknoteArrowUpIcon,
  HouseIcon,
  KeyRoundIcon,
  PlugIcon,
  ReceiptTextIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";
import { HeraldLogo, HeraldMark } from "@/components/brand/herald-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { AccountMenu } from "./account-menu";
import { EnvironmentBadge } from "./environment-badge";

type NavItem = { to: LinkProps["to"] & string; label: string; icon: LucideIcon };
/** A group of pages; one without a label sits at the top, unheaded. */
type NavSection = { label?: string; items: NavItem[] };

/** The dashboard's pages, grouped by who reaches for them. */
export const navSections: NavSection[] = [
  {
    items: [
      { to: "/overview", label: "Home", icon: HouseIcon },
      { to: "/payments", label: "Payments", icon: ReceiptTextIcon },
      { to: "/withdraw", label: "Withdraw", icon: BanknoteArrowUpIcon },
    ],
  },
  {
    label: "Developers",
    items: [
      { to: "/integration", label: "Connect your API", icon: PlugIcon },
      { to: "/api-keys", label: "API keys", icon: KeyRoundIcon },
    ],
  },
];

const adminSection: NavSection = {
  label: "Herald team",
  items: [{ to: "/admin", label: "Admin", icon: ShieldIcon }],
};

export function AppSidebar(props: {
  account: { accountId: string; isAdmin: boolean };
  heraldEnv: HeraldEnv;
}) {
  const sections = props.account.isAdmin ? [...navSections, adminSection] : navSections;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4 pb-2 group-data-[collapsible=icon]:px-2">
        <Link
          to="/overview"
          className="flex h-8 items-center rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <HeraldLogo className="h-5 group-data-[collapsible=icon]:hidden" />
          <HeraldMark className="hidden group-data-[collapsible=icon]:block" />
          <span className="sr-only">Herald home</span>
        </Link>
        <div className="group-data-[collapsible=icon]:hidden">
          <EnvironmentBadge heraldEnv={props.heraldEnv} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label ?? "main"}>
            {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu accountId={props.account.accountId} heraldEnv={props.heraldEnv} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        className="h-9"
        render={
          <Link
            to={item.to}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
          />
        }
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
