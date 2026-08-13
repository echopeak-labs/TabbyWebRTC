# Goal

Add support for win32 platform.

# High-level overview

- Support only Windows 11 desktop edition
- Add support to retreive N number of conected pysichal displays.
- Be able to stream a display output when commanded by the webapp
- Add support to retrive N number of running apps that are running in user
  space. Get framebuffer of a given app when commanded by the webapp
- Fetch all running apps of the logged in user
- Create CI/CD pipeline to build/deploy desktop agent artifact as a exe file and
  MSI installer
