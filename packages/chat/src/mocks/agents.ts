import type { FeaturedAgent } from "../types/agent";

export const featuredAgents: FeaturedAgent[] = [
  {
    id: "1",
    name: "Agent 1",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris porttitor vehicula quam, in pulvinar nunc congue quis. Duis commodo sem eros, at maximus neque hendrerit sit amet. Morbi orci turpis, fringilla nec felis sed, dignissim rhoncus odio. Proin cursus posuere blandit. Phasellus at sagittis nisl. Etiam ullamcorper sit amet nulla et fringilla. Sed aliquam et lacus quis dapibus. Suspendisse consectetur laoreet mi, et blandit leo convallis eleifend.",
    image: "http://localhost:5173/logo.png",
    score: 92,
    calls: 14_000,
    position: 0,
  },
  {
    id: "2",
    name: "Agent 2",
    description:
      "Cras dictum in mauris volutpat cursus. Duis id rutrum libero. Curabitur laoreet, risus a varius auctor, urna est euismod urna, ut sagittis eros metus ac diam. Cras dui orci, ultrices eget pellentesque nec, cursus vestibulum lectus. Integer aliquam ornare massa, nec posuere dui feugiat a. Vivamus quis sem in enim imperdiet porta et quis ante. In hac habitasse platea dictumst. Cras nisi lectus, fermentum sit amet posuere id, egestas non neque. Vestibulum maximus at ligula in vulputate. Fusce mollis sodales ante, in elementum erat. Duis et elit in ligula facilisis hendrerit. Nunc pulvinar nisi tincidunt interdum pretium. Suspendisse potenti.",
    image: "http://localhost:5173/logo.png",
    score: 99,
    calls: 5_004,
    position: 1,
  },
  {
    id: "3",
    name: "Agent 3",
    description:
      "Etiam lectus dui, laoreet non condimentum eu, ullamcorper vel dui. Suspendisse quis libero libero. Etiam arcu lacus, viverra sed malesuada vel, blandit vitae purus. Donec sit amet nibh eros. Integer laoreet sem in dui pulvinar tristique. Donec ultrices magna ut venenatis placerat. Sed dignissim nibh tellus, eu sagittis nulla mattis hendrerit. Pellentesque vulputate diam vitae diam placerat volutpat. Aenean feugiat, magna vel dictum tristique, enim elit dignissim orci, non tincidunt mi urna eget eros. Vestibulum at justo maximus, pharetra turpis in, interdum ligula. Nullam interdum fermentum auctor. Nam maximus convallis lobortis.",
    image: "http://localhost:5173/logo.png",
    score: 97,
    calls: 2_400,
    position: 2,
  },
];
