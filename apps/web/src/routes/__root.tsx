import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "@spaceobject/ui/globals.css";
import type { ReactNode } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Herald",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument(props: { children: ReactNode }) {
  return (
    <html className="dark" lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.remove('dark')}catch{}",
          }}
        />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
