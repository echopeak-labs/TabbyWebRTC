# Problem

From a product POV and a end user, there is currently no way to download the
desktop agent. The goal of this project is to be a free public webapp in which
another developer can clone the repo and deploy the app on their aws infra for
their own use.

The current issue is that if the use does clone the repo and build eaverything
and deploys. There is no easy way a developer can select which device can be the
host as in what device will have the desktop agent installed.

It makes sense to add a full screen UI dialog with 2 cards that shows up on
first page render in which the user can select between Host and Guest. With the
host showing download buttons from the s3 infra to call the download endpoints,
and show releivent info to setup the agent like install instructions. ANd Guest,
which once click shows the current UI which is the "viewer/qrcode" page.
